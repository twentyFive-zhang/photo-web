import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type {
  BaiduConnectionStatus,
  BaiduDirectoryListing,
} from "@photo/shared";
import type { SessionRequest } from "../common/admin.guard.js";
import { AdminGuard } from "../common/admin.guard.js";
import type { Env } from "../config/env.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiError, BaiduApiService } from "./baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "./baidu-credential.service.js";
import { toBaiduDirectoryListing } from "./baidu-mapper.js";

/** 2026-06-03 后创建的应用，文件接口只能访问 /apps/{应用名}/。 */
const BROWSE_ROOT = "/apps";

@Controller("admin/baidu")
@UseGuards(AdminGuard)
export class BaiduController {
  constructor(
    private readonly baiduApi: BaiduApiService,
    private readonly credentials: BaiduCredentialService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** 浏览根：配置了 BAIDU_APP_NAME 时直接定位应用目录（/apps 虚拟根部分账号不可列）。 */
  private get browseRoot(): string {
    const appName = this.config.get("BAIDU_APP_NAME", { infer: true });
    return appName ? `${BROWSE_ROOT}/${appName}` : BROWSE_ROOT;
  }

  @Get("status")
  status(): Promise<BaiduConnectionStatus> {
    return this.credentials.getStatus();
  }

  /** 302 到百度授权页；state 存 session 防 CSRF，callback 校验。 */
  @Get("authorize")
  @Redirect()
  async authorize(@Req() request: SessionRequest): Promise<{ url: string }> {
    if (!this.baiduApi.isAppConfigured()) {
      throw new BadRequestException("未配置百度应用（BAIDU_APP_KEY 等）");
    }
    const state = randomBytes(16).toString("hex");
    request.session.baiduOAuthState = state;
    return { url: this.baiduApi.authorizeUrl(state) };
  }

  /** 授权回调：校验 state → 换 token → uinfo 验证 → 落库 → 回后台。 */
  @Get("callback")
  @Redirect()
  async callback(
    @Req() request: SessionRequest,
    @Query("code") code?: string,
    @Query("state") state?: string,
  ): Promise<{ url: string }> {
    const adminUrl = this.config.get("ADMIN_URL", { infer: true });
    if (!code || !state || state !== request.session.baiduOAuthState) {
      throw new BadRequestException("授权回调参数无效（state 校验失败）");
    }
    delete request.session.baiduOAuthState;

    const token = await this.baiduApi.exchangeToken(code);
    await this.baiduApi.uinfo(token.access_token);
    await this.credentials.save(token, token.scope);
    return { url: adminUrl };
  }

  @Post("disconnect")
  async disconnect(): Promise<void> {
    await this.credentials.disconnect();
  }

  /** 浏览网盘目录（根路径限定 /apps）。目录在网盘侧不存在时返回空列表。 */
  @Get("files")
  async files(
    @Query("dir") dirParam?: string,
    @Query("page") pageParam?: string,
  ): Promise<BaiduDirectoryListing> {
    if (!(await this.credentials.isConnected())) {
      throw new ConflictException("尚未连接百度网盘，请先授权");
    }
    const dir = this.normalizeDir(dirParam);
    const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
    let response: Awaited<ReturnType<typeof this.baiduApi.list>>;
    try {
      response = await this.credentials.withAccessToken((token) =>
        this.baiduApi.list(token, dir, page),
      );
    } catch (error) {
      // 目录尚未同步到网盘（如新建专辑还没推送过照片）→ 视为空目录
      if (error instanceof BaiduApiError && error.errno === -9) {
        return { dir, page, hasMore: false, entries: [] };
      }
      throw error;
    }
    return toBaiduDirectoryListing(dir, page, response);
  }
  /** 归一化浏览目录：空 → 浏览根；越出 /apps 一律拒到边界。 */
  private normalizeDir(raw?: string): string {
    const dir = raw?.trim();
    if (!dir || dir === "/" || dir === BROWSE_ROOT) {
      return this.browseRoot;
    }
    if (!dir.startsWith(`${BROWSE_ROOT}/`)) {
      throw new BadRequestException("只能浏览 /apps/ 目录下的文件");
    }
    return dir.replace(/\/+$/, "") || this.browseRoot;
  }
}
