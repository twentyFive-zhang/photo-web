import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type { BaiduConnectionStatus } from "@photo/shared";
import { decryptAes256Gcm, encryptAes256Gcm } from "../common/crypto.util.js";
import type { Env } from "../config/env.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
import type { BaiduTokenResponse } from "./baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiService, BaiduAuthError } from "./baidu-api.service.js";

/** token 有效期不足 24h 即提前刷新，避免导入中途过期。 */
const REFRESH_AHEAD_MS = 24 * 60 * 60 * 1000;

/**
 * BaiduCredential 单行的读写：token AES-256-GCM 加密落库，
 * access_token 懒刷新（距过期 <24h 或调用报 -6/111 时刷新一次并重试）。
 */
@Injectable()
export class BaiduCredentialService {
  /** in-flight 刷新去重：并发请求只触发一次 refresh。 */
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly baiduApi: BaiduApiService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async isConnected(): Promise<boolean> {
    const credential = await this.prisma.baiduCredential.findUnique({
      where: { id: "singleton" },
      select: { id: true },
    });
    return credential !== null;
  }

  async getStatus(): Promise<BaiduConnectionStatus> {
    const credential = await this.prisma.baiduCredential.findUnique({
      where: { id: "singleton" },
      select: { scope: true, expiresAt: true },
    });
    return {
      appConfigured: this.baiduApi.isAppConfigured(),
      connected: credential !== null,
      scope: credential?.scope ?? null,
      expiresAt: credential?.expiresAt.toISOString() ?? null,
    };
  }

  /** OAuth 回调后保存/覆盖凭证。 */
  async save(token: BaiduTokenResponse, scope: string): Promise<void> {
    const data = {
      accessToken: this.encrypt(token.access_token),
      refreshToken: this.encrypt(token.refresh_token),
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scope,
    };
    await this.prisma.baiduCredential.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton", ...data },
    });
  }

  async disconnect(): Promise<void> {
    await this.prisma.baiduCredential.deleteMany({
      where: { id: "singleton" },
    });
  }

  /**
   * 取可用 access_token（必要时先刷新）。
   * 刷新依赖 refresh_token（10 年有效）；refresh 失败视为需要重新授权。
   */
  async getValidAccessToken(): Promise<string> {
    await this.refreshIfNeeded();
    return this.decryptToken("accessToken");
  }

  /**
   * 执行一次百度 API 调用：token 失效（-6/111）时刷新后重试一次。
   * fn 必须是幂等或只读的（重试安全）。
   */
  async withAccessToken<T>(
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    try {
      return await fn(accessToken);
    } catch (error) {
      if (!(error instanceof BaiduAuthError)) {
        throw error;
      }
      await this.forceRefresh();
      const freshToken = await this.decryptToken("accessToken");
      return fn(freshToken);
    }
  }

  private async refreshIfNeeded(): Promise<void> {
    const credential = await this.prisma.baiduCredential.findUnique({
      where: { id: "singleton" },
      select: { expiresAt: true },
    });
    if (!credential) {
      throw new BaiduAuthError(-6);
    }
    if (credential.expiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS) {
      return;
    }
    await this.forceRefresh();
  }

  private async forceRefresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const credential = await this.prisma.baiduCredential.findUnique({
      where: { id: "singleton" },
      select: { refreshToken: true, scope: true },
    });
    if (!credential) {
      throw new BaiduAuthError(-6);
    }
    const token = await this.baiduApi.refreshToken(
      this.decrypt(credential.refreshToken),
    );
    await this.save(token, token.scope || credential.scope || "");
  }

  private encrypt(plaintext: string): string {
    return encryptAes256Gcm(
      plaintext,
      this.config.get("APP_ENCRYPTION_KEY", { infer: true }),
    );
  }

  private decrypt(payload: string): string {
    return decryptAes256Gcm(
      payload,
      this.config.get("APP_ENCRYPTION_KEY", { infer: true }),
    );
  }

  private async decryptToken(
    field: "accessToken" | "refreshToken",
  ): Promise<string> {
    const credential = await this.prisma.baiduCredential.findUnique({
      where: { id: "singleton" },
      select: { [field]: true },
    });
    if (!credential) {
      throw new BaiduAuthError(-6);
    }
    return decryptAes256Gcm(
      credential[field],
      this.config.get("APP_ENCRYPTION_KEY", { infer: true }),
    );
  }
}
