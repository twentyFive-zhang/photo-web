import { randomBytes } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  PublicSiteSetting,
  SiteSetting,
  UpdateSiteSettingInput,
} from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { StorageService } from "../storage/storage.service.js";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

  /** 上传微信二维码：存入 storage 并更新 wechatQrKey，旧文件删除。 */
  async updateQr(file: Express.Multer.File): Promise<SiteSetting> {
    const current = await this.get();
    const ext = file.mimetype === "image/png" ? "png" : "jpg";
    const key = `settings/wechat-qr-${randomBytes(6).toString("hex")}.${ext}`;

    await this.storage.put(key, file.buffer);
    const updated = await this.update({ wechatQrKey: key });

    if (current.wechatQrKey) {
      await this.storage.deleteMany([current.wechatQrKey]);
    }
    return updated;
  }

  /** 公开站点设置：微信二维码转为完整 URL，内部字段不暴露。 */
  async getPublic(): Promise<PublicSiteSetting> {
    const setting = await this.get();
    return {
      siteName: setting.siteName,
      siteDescription: setting.siteDescription,
      about: setting.about,
      contactEmail: setting.contactEmail,
      wechatQrUrl: setting.wechatQrKey
        ? this.storage.publicUrl(setting.wechatQrKey)
        : null,
      socialLinks: setting.socialLinks.map(({ label, url }) => ({
        label,
        url,
      })),
    };
  }
}
