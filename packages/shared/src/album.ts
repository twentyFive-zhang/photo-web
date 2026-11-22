import { z } from "zod";
import { visibilitySchema } from "./auth.js";
import { photoSchema } from "./photo.js";

/** 照片摘要（用于专辑封面 / 列表缩略信息）。 */
export const photoSummarySchema = z.object({
  id: z.string(),
  publicId: z.string(),
  title: z.string().nullable(),
});
export type PhotoSummary = z.infer<typeof photoSummarySchema>;

/** 后台专辑视图。cover 为生效封面：coverPhotoId 优先，否则成员排序第一张，空专辑为 null。 */
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
  /** 显式设置封面；null 表示清除手动封面（回落到成员排序第一张）。 */
  coverPhotoId: z.string().nullable().optional(),
  visibility: visibilitySchema.optional(),
});
export type UpdateAlbumInput = z.infer<typeof updateAlbumInputSchema>;

export const reorderPhotosInputSchema = z.object({
  /** 完整的有序照片 id 列表，按此顺序重写成员关系 sortOrder。 */
  photoIds: z.array(z.string().min(1)).min(1, "至少需要一张照片"),
});
export type ReorderPhotosInput = z.infer<typeof reorderPhotosInputSchema>;

/** 加入成员（追加到专辑末尾）；已是成员的照片自动忽略。 */
export const addAlbumPhotosInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1, "至少需要一张照片"),
});
export type AddAlbumPhotosInput = z.infer<typeof addAlbumPhotosInputSchema>;

/** 移出成员（只拆成员关系，照片本身保留在照片库）。 */
export const removeAlbumPhotosInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1, "至少需要一张照片"),
});
export type RemoveAlbumPhotosInput = z.infer<
  typeof removeAlbumPhotosInputSchema
>;

/** 专辑内成员照片行：照片字段 + 专辑内顺序（成员关系持有，非照片属性）。 */
export const albumPhotoSchema = photoSchema.extend({
  sortOrder: z.number().int(),
});
export type AlbumPhoto = z.infer<typeof albumPhotoSchema>;
