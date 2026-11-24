import { randomBytes } from "node:crypto";
import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type { Admin } from "@photo/shared";
import argon2 from "argon2";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
import type { OidcClaims } from "./oidc.service.js";

function toAdmin(admin: {
  id: string;
  username: string;
  createdAt: Date;
}): Admin {
  return {
    id: admin.id,
    username: admin.username,
    createdAt: admin.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** break-glass 应急登录：仅限 sub 为空的本地账号（统一登录账号在此直接拒绝）。 */
  async login(username: string, password: string): Promise<Admin> {
    const admin = await this.prisma.admin.findUnique({
      where: { username },
    });

    // 用户不存在时也跑一次校验，避免通过响应时间区分用户名是否存在
    const passwordHash =
      admin?.passwordHash ??
      "$argon2id$v=19$m=65536,t=3,p=4$dGhpcy1pcy1ub3QtYS1yZWFsLWhhc2g$invalidsaltinvalidsaltinvalidsal";

    const valid = await argon2
      .verify(passwordHash, password)
      .catch(() => false);

    if (!admin || !valid) {
      throw new UnauthorizedException("用户名或密码错误");
    }

    // 统一登录账号（sub 非空，自动建号）没有可用密码，不走本地登录
    if (admin.sub) {
      throw new UnauthorizedException("该账号为统一登录账号，请使用统一登录");
    }

    if (await argon2.needsRehash(admin.passwordHash)) {
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { passwordHash: await argon2.hash(password) },
      });
    }

    return toAdmin(admin);
  }

  /**
   * 统一登录映射：sub 已有记录 → 直接登录；首次登录且在准入组 → 自动建号
   * （记录来源 = sub 非空，passwordHash 为不可登录占位）；不在准入组 → 403。
   */
  async loginWithOidc(claims: OidcClaims): Promise<Admin> {
    const adminGroup = this.config.get<string>(
      "OIDC_ADMIN_GROUP",
      "photo-web-admin",
    );
    if (!claims.groups.includes(adminGroup)) {
      throw new ForbiddenException(
        `不在 ${adminGroup} 组，无后台访问权限（请在统一门禁申请授权）`,
      );
    }

    const existing = await this.prisma.admin.findUnique({
      where: { sub: claims.sub },
    });
    if (existing) {
      return toAdmin(existing);
    }

    const username = await this.availableOidcUsername(
      claims.username,
      claims.sub,
    );
    const created = await this.prisma.admin.create({
      data: {
        sub: claims.sub,
        username,
        // 不可登录占位：login() 对 sub 非空账号直接拒绝，这里只为满足非空约束
        passwordHash: await argon2.hash(randomBytes(32).toString("hex")),
      },
    });
    this.logger.log(
      `OIDC 首次登录自动建号: username=${username} sub=${claims.sub}`,
    );
    return toAdmin(created);
  }

  async me(adminId: string): Promise<Admin> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true, createdAt: true },
    });

    if (!admin) {
      throw new UnauthorizedException("登录已失效");
    }

    return toAdmin(admin);
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await this.prisma.admin.findUniqueOrThrow({
      where: { id: adminId },
    });

    // 统一登录账号的密码由身份源管理（改密在 id.localhost 做）
    if (admin.sub) {
      throw new ForbiddenException(
        "统一登录账号的密码由身份源管理，请在登录页修改",
      );
    }

    const valid = await argon2
      .verify(admin.passwordHash, currentPassword)
      .catch(() => false);

    if (!valid) {
      throw new UnauthorizedException("当前密码错误");
    }

    await this.prisma.admin.update({
      where: { id: adminId },
      data: { passwordHash: await argon2.hash(newPassword) },
    });
  }

  /** OIDC 建号用户名：优先 preferred_username，与现有账号重名时用 sub 前缀消歧。 */
  private async availableOidcUsername(
    preferred: string,
    sub: string,
  ): Promise<string> {
    const taken = await this.prisma.admin.findUnique({
      where: { username: preferred },
      select: { id: true },
    });
    if (!taken) {
      return preferred;
    }
    const fallback = `${preferred}.${sub.slice(0, 8)}`;
    const fallbackTaken = await this.prisma.admin.findUnique({
      where: { username: fallback },
      select: { id: true },
    });
    if (!fallbackTaken) {
      return fallback;
    }
    // 理论上到不了这里（sub 前缀 + 时间戳），兜底保证不撞唯一约束
    return `${preferred}.${Date.now().toString(36)}`;
  }
}
