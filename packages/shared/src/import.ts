import { z } from "zod";

/** 网盘目录条目（/admin/baidu/files 归一化后的视图）。 */
export const baiduFileEntrySchema = z.object({
  fsId: z.number(),
  path: z.string(),
  serverFilename: z.string(),
  isDir: z.boolean(),
  size: z.number(),
  /** 百度分类码，图片为 3；目录无此字段。 */
  category: z.number().nullable(),
  thumbUrl: z.string().nullable(),
  mtime: z.number(),
});
export type BaiduFileEntry = z.infer<typeof baiduFileEntrySchema>;

/** 目录浏览响应（分页）。 */
export const baiduDirectoryListingSchema = z.object({
  dir: z.string(),
  page: z.number().int(),
  /** 是否还有下一页。 */
  hasMore: z.boolean(),
  entries: z.array(baiduFileEntrySchema),
});
export type BaiduDirectoryListing = z.infer<typeof baiduDirectoryListingSchema>;

/** 百度连接状态（绝不包含 token 本体）。 */
export const baiduConnectionStatusSchema = z.object({
  /** .env 是否配置了 BAIDU_APP_KEY/SECRET/REDIRECT_URI。 */
  appConfigured: z.boolean(),
  /** 是否已完成 OAuth 授权（BaiduCredential 存在且 token 有效）。 */
  connected: z.boolean(),
  scope: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type BaiduConnectionStatus = z.infer<typeof baiduConnectionStatusSchema>;

/**
 * 创建导入任务（ADR 0006 收编两段式第一步；ADR 0007 专辑页一步挂专辑）：
 * 勾选的网盘条目（文件或文件夹，文件夹服务端展开）登记为照片——只建照片；
 * 可选 albumId：导入成功的条目（含 sha256 去重命中的已有照片）自动纳入该专辑。
 */
export const createBaiduImportInputSchema = z.object({
  entries: z
    .array(
      z.object({
        fsId: z.number(),
        path: z
          .string()
          .min(1, "路径不能为空")
          .startsWith("/apps/", "只能导入 /apps/ 目录下的文件"),
        serverFilename: z.string().min(1),
        isDir: z.boolean(),
        size: z.number(),
      }),
    )
    .min(1, "至少选择一个文件或文件夹"),
  /** 可选：导入完成后把照片纳入该专辑（专辑不存在时整个请求 404）。 */
  albumId: z.string().min(1).optional(),
});
export type CreateBaiduImportInput = z.infer<
  typeof createBaiduImportInputSchema
>;

export const importItemStatusSchema = z.enum([
  "PENDING",
  "DOWNLOADING",
  "PROCESSING",
  "SUCCEEDED",
  "SKIPPED",
  "FAILED",
]);
export type ImportItemStatus = z.infer<typeof importItemStatusSchema>;

export const importJobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
]);
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

export const importItemSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  sourceFileId: z.string(),
  filename: z.string(),
  status: importItemStatusSchema,
  error: z.string().nullable(),
  photoId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportItem = z.infer<typeof importItemSchema>;

/** 导入任务视图（含条目明细，用于失败原因展示）。 */
export const importJobSchema = z.object({
  id: z.string(),
  source: z.enum(["BAIDU", "LOCAL"]),
  status: importJobStatusSchema,
  total: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  error: z.string().nullable(),
  items: z.array(importItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportJob = z.infer<typeof importJobSchema>;
