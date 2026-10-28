import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.js";

/** token 失效（errno -6）或 token 过期（errno 111），应刷新后重试。 */
export class BaiduAuthError extends Error {
  constructor(errno: number) {
    super(`百度授权失效 (errno ${errno})`);
    this.name = "BaiduAuthError";
  }
}

/** 频率/次数超限。 */
export class BaiduRateLimitError extends Error {
  constructor(errno: number) {
    super(`百度接口调用超限 (errno ${errno})`);
    this.name = "BaiduRateLimitError";
  }
}

export class BaiduApiError extends Error {
  constructor(
    message: string,
    readonly errno: number,
  ) {
    super(message);
    this.name = "BaiduApiError";
  }
}

/** 百度 OAuth token 接口返回。 */
export interface BaiduTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** method=list 的条目（原始字段为下划线命名）。 */
export interface BaiduListEntry {
  fs_id: number;
  path: string;
  server_filename: string;
  size: number;
  isdir: number;
  category: number;
  server_mtime: number;
  thumbs?: { url1?: string; url2?: string; url3?: string };
}

export interface BaiduListResponse {
  errno: number;
  list?: BaiduListEntry[];
}

export interface BaiduFilemetaEntry {
  fs_id: number;
  path?: string;
  filename?: string;
  dlink?: string;
}

export interface BaiduFilemetasResponse {
  errno: number;
  list?: BaiduFilemetaEntry[];
}

export interface BaiduUinfoResponse {
  errno: number;
  uk?: number;
  baidu_name?: string;
}

const PAN_BASE = "https://pan.baidu.com";
const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";

/** errno → 类型化错误；调用方据此决定是否刷新 token / 重试。 */
function assertOk(errno: number, context: string): void {
  if (errno === 0) {
    return;
  }
  if (errno === -6 || errno === 111) {
    throw new BaiduAuthError(errno);
  }
  if (errno === 12 || errno === -70) {
    throw new BaiduRateLimitError(errno);
  }
  throw new BaiduApiError(`${context}失败 (errno ${errno})`, errno);
}

/**
 * 百度网盘开放平台薄客户端。所有接口形状只在这里出现，
 * 响应字段以 pan.baidu.com/union/doc 文档为准，出入只改本文件。
 */
@Injectable()
export class BaiduApiService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get appKey(): string {
    return this.config.get("BAIDU_APP_KEY", { infer: true }) ?? "";
  }

  private get appSecret(): string {
    return this.config.get("BAIDU_APP_SECRET", { infer: true }) ?? "";
  }

  private get redirectUri(): string {
    return this.config.get("BAIDU_REDIRECT_URI", { infer: true }) ?? "";
  }

  /** .env 是否配置齐三项百度应用凭证。 */
  isAppConfigured(): boolean {
    return Boolean(this.appKey && this.appSecret && this.redirectUri);
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.appKey,
      redirect_uri: this.redirectUri,
      scope: "basic,netdisk",
      display: "page",
      state,
    });
    return `https://openapi.baidu.com/oauth/2.0/authorize?${params.toString()}`;
  }

  async exchangeToken(code: string): Promise<BaiduTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.appKey,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
    });
    return this.tokenRequest(params, "换取 access_token");
  }

  async refreshToken(refreshToken: string): Promise<BaiduTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.appKey,
      client_secret: this.appSecret,
    });
    return this.tokenRequest(params, "刷新 access_token");
  }

  /** 用 uinfo 冒烟验证 token 可用（顺带拿 uk，当前不持久化）。 */
  async uinfo(accessToken: string): Promise<BaiduUinfoResponse> {
    const params = new URLSearchParams({
      method: "uinfo",
      access_token: accessToken,
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/nas?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduUinfoResponse;
    assertOk(data.errno, "获取用户信息");
    return data;
  }

  /**
   * 列目录。dir 必须以 /apps 开头（2026-06 后创建应用的目录权限边界）。
   * web=1 返回缩略图；page/num 分页（num 上限 1000，这里取 100）。
   */
  async list(
    accessToken: string,
    dir: string,
    page: number,
  ): Promise<BaiduListResponse> {
    const params = new URLSearchParams({
      method: "list",
      access_token: accessToken,
      dir,
      web: "1",
      page: String(page),
      num: "100",
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/file?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduListResponse;
    assertOk(data.errno, "列出网盘目录");
    return data;
  }

  /** 批量取文件元信息（含 dlink），单次最多 100 个 fsid。 */
  async filemetas(
    accessToken: string,
    fsIds: number[],
  ): Promise<BaiduFilemetaEntry[]> {
    const params = new URLSearchParams({
      method: "filemetas",
      access_token: accessToken,
      fsids: JSON.stringify(fsIds),
      dlink: "1",
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/multimedia?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduFilemetasResponse;
    assertOk(data.errno, "查询文件元信息");
    return data.list ?? [];
  }

  /**
   * 下载 dlink 指向的文件内容。要求固定 User-Agent，
   * dlink 有时效且不可落库——每条目下载前现取。
   */
  async download(dlink: string, accessToken: string): Promise<Buffer> {
    const url = `${dlink}${dlink.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "pan.baidu.com" },
    });
    if (!response.ok) {
      throw new BaiduApiError(
        `下载文件失败 (HTTP ${response.status})`,
        response.status,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async tokenRequest(
    params: URLSearchParams,
    context: string,
  ): Promise<BaiduTokenResponse> {
    const response = await fetch(`${OAUTH_TOKEN_URL}?${params.toString()}`);
    const data = (await response.json()) as Partial<BaiduTokenResponse> & {
      error?: string;
      error_description?: string;
    };
    if (!data.access_token || !data.refresh_token) {
      throw new BaiduApiError(
        `${context}失败 (${data.error ?? response.status}${data.error_description ? `: ${data.error_description}` : ""})`,
        response.status,
      );
    }
    return data as BaiduTokenResponse;
  }
}
