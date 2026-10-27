import { z } from "zod";
import { photoSummarySchema } from "./album.js";

/** 精选列表项（全站独立列表，顺序人工排）。thumbKey 供后台缩略图（/media/{key}）。 */
export const featuredItemSchema = z.object({
  photoId: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  photo: photoSummarySchema,
  thumbKey: z.string().nullable(),
});
export type FeaturedItem = z.infer<typeof featuredItemSchema>;

/** 全量替换精选列表；空数组 = 清空。 */
export const setFeaturedInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).max(200, "精选最多 200 张"),
});
export type SetFeaturedInput = z.infer<typeof setFeaturedInputSchema>;
