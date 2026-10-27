import { z } from "zod";
import { tagSchema } from "./tag.js";

export const photoVariantSchema = z.enum(["THUMB", "DISPLAY", "LARGE"]);
export type PhotoVariant = z.infer<typeof photoVariantSchema>;

export const imageFormatSchema = z.enum(["WEBP", "JPEG"]);
export type ImageFormat = z.infer<typeof imageFormatSchema>;

export const photoRenditionSchema = z.object({
  id: z.string(),
  variant: photoVariantSchema,
  format: imageFormatSchema,
  key: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
});
export type PhotoRendition = z.infer<typeof photoRenditionSchema>;

/** 后台照片视图。exif 为相机/镜头/光圈/快门/ISO/拍摄时间等结构化数据，不含 GPS。 */
export const photoSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  albumId: z.string(),
  album: z.object({
    id: z.string(),
    publicId: z.string(),
    title: z.string(),
  }),
  title: z.string().nullable(),
  caption: z.string().nullable(),
  originalKey: z.string(),
  sha256: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  exif: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number().int(),
  tags: z.array(tagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Photo = z.infer<typeof photoSchema>;

export const updatePhotoInputSchema = z.object({
  title: z.string().max(200, "标题最长 200 字").nullable().optional(),
  caption: z.string().max(2000, "说明最长 2000 字").nullable().optional(),
});
export type UpdatePhotoInput = z.infer<typeof updatePhotoInputSchema>;

export const setPhotoTagsInputSchema = z.object({
  names: z
    .array(z.string().min(1, "标签不能为空").max(50, "标签最长 50 字"))
    .max(50, "一张照片最多 50 个标签"),
});
export type SetPhotoTagsInput = z.infer<typeof setPhotoTagsInputSchema>;

export const batchMovePhotosInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1, "至少选择一张照片"),
  targetAlbumId: z.string().min(1),
});
export type BatchMovePhotosInput = z.infer<typeof batchMovePhotosInputSchema>;

export const batchDeletePhotosInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1, "至少选择一张照片"),
});
export type BatchDeletePhotosInput = z.infer<
  typeof batchDeletePhotosInputSchema
>;
