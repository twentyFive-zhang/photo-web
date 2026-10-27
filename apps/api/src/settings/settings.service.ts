import { Injectable, NotFoundException } from "@nestjs/common";
import type { SiteSetting, UpdateSiteSettingInput } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

function toSiteSetting(setting: {
  siteName: string;
  siteDescription: string;
  about: string;
  contactEmail: string | null;
  wechatQrKey: string | null;
  socialLinks: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SiteSetting {
  return {
    siteName: setting.siteName,
    siteDescription: setting.siteDescription,
    about: setting.about,
    contactEmail: setting.contactEmail,
    wechatQrKey: setting.wechatQrKey,
    socialLinks: Array.isArray(setting.socialLinks)
      ? (setting.socialLinks as SiteSetting["socialLinks"])
      : [],
    createdAt: setting.createdAt.toISOString(),
    updatedAt: setting.updatedAt.toISOString(),
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 单例站点设置；不存在时创建默认值。 */
  async get(): Promise<SiteSetting> {
    const setting = await this.prisma.siteSetting.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });
    return toSiteSetting(setting);
  }

  async update(input: UpdateSiteSettingInput): Promise<SiteSetting> {
    // 先确保单例存在
    await this.get();

    const setting = await this.prisma.siteSetting
      .update({
        where: { id: "singleton" },
        data: {
          ...(input.siteName !== undefined ? { siteName: input.siteName } : {}),
          ...(input.siteDescription !== undefined
            ? { siteDescription: input.siteDescription }
            : {}),
          ...(input.about !== undefined ? { about: input.about } : {}),
          // 空字符串归一化为 null（“未填写”）
          ...(input.contactEmail !== undefined
            ? {
                contactEmail: input.contactEmail ? input.contactEmail : null,
              }
            : {}),
          ...(input.wechatQrKey !== undefined
            ? { wechatQrKey: input.wechatQrKey }
            : {}),
          ...(input.socialLinks !== undefined
            ? { socialLinks: input.socialLinks }
            : {}),
        },
      })
      .catch(() => {
        throw new NotFoundException("站点设置不存在");
      });
    return toSiteSetting(setting);
  }
}
