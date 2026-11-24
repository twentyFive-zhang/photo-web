import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import * as oidc from "openid-client";
import type {
  OidcLoginChallenge,
  SessionRequest,
} from "../common/admin.guard.js";

/** OIDC 登录拿到的身份断言（userinfo，groups claim 随 profile scope 下发）。 */
export type OidcClaims = {
  sub: string;
  username: string;
  groups: string[];
};

/** 会话回查 TTL 缓存时长：60s 内不重复打身份源（guard 每个管理请求都会走）。 */
const BACKSTOP_CACHE_TTL_MS = 60_000;
/** 准入组 pk 缓存时长。 */
const GROUP_PK_CACHE_TTL_MS = 600_000;

type AuthentikUser = {
  pk: number;
  username: string;
  is_active: boolean;
  // Core API 的 user.groups 是组 pk（uuid）数组
  groups: string[];
};

/**
 * 统一登录（OIDC，身份源 = Authentik）+ 会话回查。
 *
 * 设计要点（DESIGN.md §1 P2）：
 * - authorize 走浏览器（302），token/userinfo 由 API 服务端向 id.localhost 请求
 *   （宿主进程直接解析 id.localhost → Caddy；issuer 是 http，需 allowInsecureRequests）。
 * - 会话回查 fail-closed：Redis session 感知不到 IdP 侧禁用/摘组，guard 对 sub 非空的
 *   管理请求用 service account token 查 Core API（is_active + 准入组成员资格），
 *   身份源异常 → 502，用户失效 → 401；sub 为空的 break-glass 账号跳过回查。
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  private discoveryPromise: Promise<oidc.Configuration> | null = null;
  private readonly backstopCache = new Map<string, number>();
  private groupPkCache: { pk: string; at: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  /* ---------- 登录流 ---------- */

  /** 生成 authorize 跳转 URL（PKCE + state + nonce；challenge 由调用方存 session）。 */
  async startLogin(): Promise<{ url: string; challenge: OidcLoginChallenge }> {
    const d = await this.discovery();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge: OidcLoginChallenge = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier,
    };
    const url = oidc.buildAuthorizationUrl(d, {
      redirect_uri: this.config.getOrThrow<string>("OIDC_REDIRECT_URI"),
      scope: this.config.get<string>("OIDC_SCOPES", "openid profile"),
      state: challenge.state,
      nonce: challenge.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    return { url: url.toString(), challenge };
  }

  /**
   * 校验回调（state/nonce/PKCE）→ 换 token → userinfo。
   * challenge 从 session 取并立即清除（一次性，防重放）。
   */
  async handleCallback(request: SessionRequest): Promise<OidcClaims> {
    const challenge = request.session.oidc;
    if (!challenge) {
      throw new UnauthorizedException("登录会话缺失或已过期，请重新发起登录");
    }
    delete request.session.oidc;

    const query = request.query as {
      error?: string;
      error_description?: string;
    };
    if (query.error) {
      throw new UnauthorizedException(
        `身份源拒绝授权（${query.error}${query.error_description ? `: ${query.error_description}` : ""}）`,
      );
    }

    const d = await this.discovery();
    const currentUrl = new URL(
      request.url,
      this.config.getOrThrow<string>("OIDC_REDIRECT_URI"),
    );
    try {
      const tokens = await oidc.authorizationCodeGrant(d, currentUrl, {
        pkceCodeVerifier: challenge.verifier,
        expectedState: challenge.state,
        expectedNonce: challenge.nonce,
      });
      const idClaims = tokens.claims();
      if (!idClaims) {
        throw new Error("id_token claims 缺失");
      }
      const userinfo = await oidc.fetchUserInfo(
        d,
        tokens.access_token,
        idClaims.sub,
      );
      return {
        sub: userinfo.sub,
        username: userinfo.preferred_username ?? userinfo.sub,
        // userinfo 的 claim 类型是宽泛的 JsonValue，groups 实际是 string[]
        groups: Array.isArray(userinfo.groups)
          ? userinfo.groups.filter((g): g is string => typeof g === "string")
          : [],
      };
    } catch (error) {
      this.logger.warn(
        `OIDC callback 校验失败: ${error instanceof Error ? error.message : error}`,
      );
      throw new UnauthorizedException("统一登录校验失败，请重新登录");
    }
  }

  /** 登录成功后的跳转地址（admin SPA 的 /albums）。 */
  postLoginRedirect(): string {
    const adminUrl = this.config.get<string>(
      "ADMIN_URL",
      "http://localhost:5173/admin",
    );
    const base = adminUrl.endsWith("/") ? adminUrl : `${adminUrl}/`;
    return new URL("albums", base).toString();
  }

  /* ---------- 会话回查（guard 用） ---------- */

  /**
   * 确认 sub 对应的身份源用户仍 active 且仍在后台准入组。
   * fail-closed：身份源网络/服务异常 → 502；用户失效/摘组/未配置回查凭据 → 401/503。
   */
  async assertSessionValid(admin: {
    sub: string;
    username: string;
  }): Promise<void> {
    const cachedAt = this.backstopCache.get(admin.sub);
    if (cachedAt && Date.now() - cachedAt < BACKSTOP_CACHE_TTL_MS) {
      return;
    }

    const token = this.config.get<string>("AUTHENTIK_API_TOKEN");
    if (!token) {
      // fail-closed：回查凭据未配置时 OIDC 会话一律拒绝（break-glass 不受影响）
      throw new ServiceUnavailableException(
        "身份源回查未配置（AUTHENTIK_API_TOKEN）",
      );
    }

    try {
      const user = await this.fetchAuthentikUser(admin.username, token);
      if (!user) {
        throw new UnauthorizedException("身份源用户不存在，登录已失效");
      }
      if (user.is_active === false) {
        throw new UnauthorizedException("账号已在身份源被禁用");
      }
      const groupPk = await this.adminGroupPk(token);
      if (!groupPk || !user.groups.includes(groupPk)) {
        throw new UnauthorizedException("不在后台准入组，登录已失效");
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(
        `会话回查失败（fail-closed）: ${error instanceof Error ? error.message : error}`,
      );
      throw new BadGatewayException("身份源不可达，会话校验失败");
    }

    this.backstopCache.set(admin.sub, Date.now());
  }

  /* ---------- 内部 ---------- */

  /** discovery 结果按进程缓存（首次失败可重试）。 */
  private async discovery(): Promise<oidc.Configuration> {
    if (!this.discoveryPromise) {
      const clientSecret = this.config.get<string>("OIDC_CLIENT_SECRET");
      if (!clientSecret) {
        throw new ServiceUnavailableException(
          "统一登录未配置（OIDC_CLIENT_SECRET 缺失）",
        );
      }
      this.discoveryPromise = oidc
        .discovery(
          new URL(this.config.getOrThrow<string>("OIDC_ISSUER")),
          this.config.getOrThrow<string>("OIDC_CLIENT_ID"),
          clientSecret,
          undefined,
          // issuer 是 http://id.localhost（Caddy 纯 HTTP 入口），需显式允许不安全请求
          { execute: [oidc.allowInsecureRequests] },
        )
        .catch((error: unknown) => {
          // 允许下次请求重试，避免缓存住失败的 promise
          this.discoveryPromise = null;
          this.logger.error(
            `OIDC discovery 失败: ${error instanceof Error ? error.message : error}`,
          );
          throw new ServiceUnavailableException(
            "统一登录不可用（身份源 discovery 失败）",
          );
        });
    }
    return this.discoveryPromise;
  }

  private apiUrl(): string {
    return this.config.getOrThrow<string>("AUTHENTIK_API_URL");
  }

  /** 按 username 查身份源用户；查无此人返回 null。非 200 一律抛错（走 fail-closed 502）。 */
  private async fetchAuthentikUser(
    username: string,
    token: string,
  ): Promise<AuthentikUser | null> {
    const res = await fetch(
      `${this.apiUrl()}/core/users/?username=${encodeURIComponent(username)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`GET /core/users/ -> HTTP ${res.status}`);
    }
    const data = (await res.json()) as { results?: AuthentikUser[] };
    return data.results?.[0] ?? null;
  }

  private async adminGroupPk(token: string): Promise<string | null> {
    if (
      this.groupPkCache &&
      Date.now() - this.groupPkCache.at < GROUP_PK_CACHE_TTL_MS
    ) {
      return this.groupPkCache.pk;
    }
    const groupName = this.config.get<string>(
      "OIDC_ADMIN_GROUP",
      "photo-web-admin",
    );
    const res = await fetch(
      `${this.apiUrl()}/core/groups/?name=${encodeURIComponent(groupName)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`GET /core/groups/ -> HTTP ${res.status}`);
    }
    const data = (await res.json()) as { results?: { pk: string }[] };
    const pk = data.results?.[0]?.pk ?? null;
    if (pk) {
      this.groupPkCache = { pk, at: Date.now() };
    } else {
      this.groupPkCache = null;
    }
    return pk;
  }
}
