import { z } from "zod";

export const socialLinkSchema = z.object({
  label: z.string().min(1, "名称不能为空").max(50, "名称最长 50 字"),
  url: z.url("链接格式不正确"),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

export const siteSettingSchema = z.object({
  siteName: z.string(),
  siteDescription: z.string(),
  about: z.string(),
  contactEmail: z.string().nullable(),
  wechatQrKey: z.string().nullable(),
  socialLinks: z.array(socialLinkSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SiteSetting = z.infer<typeof siteSettingSchema>;

export const updateSiteSettingInputSchema = z
  .object({
    siteName: z.string().min(1, "站点名不能为空").max(100).optional(),
    siteDescription: z.string().max(500).optional(),
    about: z.string().max(20000).optional(),
    contactEmail: z
      .union([z.email("邮箱格式不正确"), z.literal("")])
      .nullable()
      .optional(),
    wechatQrKey: z.string().nullable().optional(),
    socialLinks: z.array(socialLinkSchema).max(20).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "至少提供一个要更新的字段");
export type UpdateSiteSettingInput = z.infer<
  typeof updateSiteSettingInputSchema
>;
