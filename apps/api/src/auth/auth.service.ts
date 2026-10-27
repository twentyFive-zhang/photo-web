import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { Admin } from "@photo/shared";
import argon2 from "argon2";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

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
  constructor(private readonly prisma: PrismaService) {}

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

    if (await argon2.needsRehash(admin.passwordHash)) {
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { passwordHash: await argon2.hash(password) },
      });
    }

    return toAdmin(admin);
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
}
