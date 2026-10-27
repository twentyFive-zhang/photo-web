import { z } from "zod";
import { imageFormatSchema, photoVariantSchema } from "./photo.js";
import { tagSchema } from "./tag.js";

/** 公开端展示用 rendition（带完整 URL；API 按 CDN_BASE_URL 计算）。 */
export const publicRenditionSchema = z.object({
  variant: photoVariantSchema,
  format: imageFormatSchema,
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  url: z.url(),
});
export type PublicRendition = z.infer<typeof publicRenditionSchema>;

/**
 * 公开照片视图：不含内部 id / albumId / originalKey / sha256，
 * EXIF 已在写入时去除 GPS。
 */
export const publicPhotoSchema = z.object({
  publicId: z.string(),
  title: z.string().nullable(),
  caption: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  exif: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number().int(),
  renditions: z.array(publicRenditionSchema),
  tags: z.array(tagSchema),
});
export type PublicPhoto = z.infer<typeof publicPhotoSchema>;

/** 公开专辑摘要（列表 / 首页最新专辑）。coverUrl 为封面 THUMB 图。 */
export const publicAlbumSummarySchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  photoCount: z.number().int(),
  publishedAt: z.string().nullable(),
  coverUrl: z.string().nullable(),
});
export type PublicAlbumSummary = z.infer<typeof publicAlbumSummarySchema>;

/** 公开专辑详情（专辑页）。 */
export const publicAlbumSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  publishedAt: z.string().nullable(),
  photos: z.array(publicPhotoSchema),
});
export type PublicAlbum = z.infer<typeof publicAlbumSchema>;
