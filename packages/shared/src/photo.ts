import { z } from "zod";
import { tagSchema } from "./tag.js";

// 两档展示变体（ADR 0005）：large(2560) 档已移除，展示上限为 display(1600)
export const photoVariantSchema = z.enum(["THUMB", "DISPLAY"]);
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

/**
 * 后台照片视图。照片独立于专辑（ADR 0006）：albums 为成员关系摘要
 * （一张照片可属多个专辑，也可不属于任何专辑）；排序是成员关系的属性，
 * 不在照片上。exif 不含 GPS。
 */
export const photoSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  albums: z.array(
    z.object({ id: z.string(), publicId: z.string(), title: z.string() }),
  ),
  title: z.string().nullable(),
  caption: z.string().nullable(),
  originalKey: z.string(),
  sha256: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  exif: z.record(z.string(), z.unknown()).nullable(),
  renditions: z.array(photoRenditionSchema),
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

export const batchDeletePhotosInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1, "至少选择一张照片"),
});
export type BatchDeletePhotosInput = z.infer<
  typeof batchDeletePhotosInputSchema
>;
