import { z } from "zod";

/** 标签。name 已规范化：去首尾空格、合并连续空白、转小写。 */
export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  photoCount: z.number().int().optional(),
});
export type Tag = z.infer<typeof tagSchema>;

/** 标签规范化：trim + 连续空白合并为单个空格 + 转小写。 */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 规范化并去重，保持首次出现顺序。 */
export function normalizeTagNames(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const name of raw) {
    const normalized = normalizeTagName(name);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return [...seen];
}
