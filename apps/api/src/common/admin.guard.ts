import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type expressSession from "express-session";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

export type SessionRequest = Request & {
  session: expressSession.Session & { adminId?: string };
};

/** 校验 session 中存在有效的管理员登录态。 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const adminId = request.session?.adminId;

    if (!adminId) {
      throw new UnauthorizedException("未登录");
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true },
    });

    if (!admin) {
      throw new UnauthorizedException("登录已失效");
    }

    return true;
  }
}
