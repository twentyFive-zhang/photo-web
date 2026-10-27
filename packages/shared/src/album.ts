import { z } from "zod";
import { visibilitySchema } from "./auth.js";

/** 照片摘要（用于专辑封面 / 列表缩略信息）。 */
export const photoSummarySchema = z.object({
  id: z.string(),
  publicId: z.string(),
  title: z.string().nullable(),
});
export type PhotoSummary = z.infer<typeof photoSummarySchema>;

/** 后台专辑视图。cover 为生效封面：coverPhotoId 优先，否则排序第一张，空专辑为 null。 */
export const albumSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  shareToken: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverPhotoId: z.string().nullable(),
  cover: photoSummarySchema.nullable(),
  visibility: visibilitySchema,
  publishedAt: z.string().nullable(),
  photoCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Album = z.infer<typeof albumSchema>;

export const createAlbumInputSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200, "标题最长 200 字"),
  description: z.string().max(2000, "描述最长 2000 字").optional(),
});
export type CreateAlbumInput = z.infer<typeof createAlbumInputSchema>;

export const updateAlbumInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  /** 显式设置封面；null 表示清除手动封面（回落到第一张照片）。 */
  coverPhotoId: z.string().nullable().optional(),
  visibility: visibilitySchema.optional(),
});
export type UpdateAlbumInput = z.infer<typeof updateAlbumInputSchema>;

export const reorderPhotosInputSchema = z.object({
  /** 完整的有序照片 id 列表，按此顺序重写 sortOrder。 */
  photoIds: z.array(z.string().min(1)).min(1, "至少需要一张照片"),
});
export type ReorderPhotosInput = z.infer<typeof reorderPhotosInputSchema>;
