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

function regenerate(request: SessionRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 登录限流：每 IP 每分钟 10 次（全局默认 100 次）。 */
  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput,
    @Req() request: SessionRequest,
  ): Promise<Admin> {
    const admin = await this.authService.login(body.username, body.password);
    // 登录成功后更换 session id，防会话固定
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
}
