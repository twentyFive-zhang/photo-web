import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type expressSession from "express-session";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { OidcService } from "../auth/oidc.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

/** OIDC 登录流的一次性 challenge（存在 express-session 里跨 302 往返）。 */
export type OidcLoginChallenge = {
  state: string;
  verifier: string;
  nonce: string;
};

export type SessionRequest = Request & {
  session: expressSession.Session & {
    adminId?: string;
    oidc?: OidcLoginChallenge;
  };
};

/** 校验 session 中存在有效的管理员登录态；OIDC 账号加身份源回查（fail-closed）。 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oidc: OidcService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const adminId = request.session?.adminId;

    if (!adminId) {
      throw new UnauthorizedException("未登录");
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true, sub: true },
    });

    if (!admin) {
      throw new UnauthorizedException("登录已失效");
    }

    // 统一登录账号（sub 非空）：回查身份源确认仍 active 且在准入组；
    // break-glass 应急账号（sub 为空）跳过回查（身份源不可用时保底的本地通道）。
    if (admin.sub) {
      await this.oidc.assertSessionValid({
        sub: admin.sub,
        username: admin.username,
      });
    }

    return true;
  }
}
