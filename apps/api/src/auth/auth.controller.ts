import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import {
  type Admin,
  type ChangePasswordInput,
  changePasswordInputSchema,
  type LoginInput,
  loginInputSchema,
} from "@photo/shared";
import type { Response } from "express";
import { AdminGuard, type SessionRequest } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AuthService } from "./auth.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { OidcService } from "./oidc.service.js";

function regenerate(request: SessionRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

/** 回调是浏览器导航，错误以极简 HTML 呈现（JSON 对人不可读）。 */
function errorPage(status: number, message: string): string {
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>登录失败</title>
<body style="font-family:system-ui;max-width:32rem;margin:20vh auto;padding:0 1rem;color:#e5e5e5;background:#171717;text-align:center">
<h1 style="font-size:1.1rem;font-weight:500">统一登录失败（HTTP ${status}）</h1>
<p style="color:#a3a3a3">${message}</p>
<p><a href="/api/auth/login" style="color:#93c5fd">重新登录</a></p>`;
}

@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcService: OidcService,
  ) {}

  /** 统一登录：302 跳身份源 authorize（state/PKCE challenge 存 session）。 */
  @Get("login")
  async oidcLogin(
    @Req() request: SessionRequest,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const { url, challenge } = await this.oidcService.startLogin();
      request.session.oidc = challenge;
      response.redirect(url);
    } catch (error) {
      const status = this.statusOf(error);
      response
        .status(status)
        .type("html")
        .send(errorPage(status, this.messageOf(error)));
    }
  }

  /** OIDC 回调：校验 state/nonce/PKCE → 换 token → 映射本地 Admin → 写 session。 */
  @Get("callback")
  async oidcCallback(
    @Req() request: SessionRequest,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const claims = await this.oidcService.handleCallback(request);
      const admin = await this.authService.loginWithOidc(claims);
      // 登录成功后更换 session id，防会话固定（与密码登录一致）
      await regenerate(request);
      request.session.adminId = admin.id;
      response.redirect(this.oidcService.postLoginRedirect());
    } catch (error) {
      const status = this.statusOf(error);
      response
        .status(status)
        .type("html")
        .send(errorPage(status, this.messageOf(error)));
    }
  }

  /**
   * break-glass 应急登录（仅 sub 为空的本地账号；常规登录走 GET /api/auth/login）。
   * 限流：每 IP 每分钟 10 次（全局默认 100 次）。
   */
  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput,
    @Req() request: SessionRequest,
  ): Promise<Admin> {
    const admin = await this.authService.login(body.username, body.password);
    await regenerate(request);
    request.session.adminId = admin.id;
    return admin;
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Req() request: SessionRequest, @Res() response: Response): void {
    request.session.destroy(() => {
      response.clearCookie("photo.sid");
      response.status(HttpStatus.NO_CONTENT).send();
    });
  }

  @Get("me")
  @UseGuards(AdminGuard)
  me(@Req() request: SessionRequest): Promise<Admin> {
    return this.authService.me(request.session.adminId as string);
  }

  @Patch("password")
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordInputSchema))
    body: ChangePasswordInput,
    @Req() request: SessionRequest,
  ): Promise<void> {
    const adminId = request.session.adminId as string;
    await this.authService.changePassword(
      adminId,
      body.currentPassword,
      body.newPassword,
    );
    // 改密后重置 session id，保留登录态
    await regenerate(request);
    request.session.adminId = adminId;
  }

  private statusOf(error: unknown): number {
    const status = (error as { status?: number; getStatus?: () => number })
      ?.status;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return status;
    }
    return HttpStatus.BAD_GATEWAY;
  }

  private messageOf(error: unknown): string {
    const message = (error as { message?: unknown })?.message;
    return typeof message === "string" && message.length > 0
      ? message
      : "请稍后重试";
  }
}
