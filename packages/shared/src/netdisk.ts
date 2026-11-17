import { z } from "zod";

/** 网盘文件名非法字符（Windows 风格），统一替换为下划线。 */
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;

/** 专辑标题/文件名 → 网盘安全目录名（非法字符替换、去首尾空白）。 */
export function sanitizeNetdiskName(name: string): string {
  const cleaned = name.replace(ILLEGAL_CHARS, "_").trim();
  return cleaned.length > 0 ? cleaned : "_";
}

/** 站内已删除、网盘删除待人工确认的条目。 */
export const netdiskPendingDeleteSchema = z.object({
  id: z.string(),
  filename: z.string(),
  albumTitle: z.string(),
  createdAt: z.string(),
});
export type NetdiskPendingDelete = z.infer<typeof netdiskPendingDeleteSchema>;

/** 推送网盘重试耗尽后的持久化失败记录（重推成功或忽略后清除）。 */
export const netdiskPushFailureSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  publicId: z.string(),
  filename: z.string(),
  albumTitle: z.string(),
  /** 百度 errno；非百度错误（网络/存储）为 null。 */
  errno: z.number().nullable(),
  error: z.string(),
  attemptedAt: z.string(),
});
export type NetdiskPushFailure = z.infer<typeof netdiskPushFailureSchema>;

/** 网盘侧缺失（被手动删除）的站内照片。 */
export const netdiskMissingPhotoSchema = z.object({
  photoId: z.string(),
  publicId: z.string(),
  filename: z.string(),
  albumTitle: z.string(),
});
export type NetdiskMissingPhoto = z.infer<typeof netdiskMissingPhotoSchema>;

/** 下行扫描报告（持久化在 SiteSetting.netdiskScanReport）。 */
export const netdiskScanReportSchema = z.object({
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  scannedAt: z.string(),
  /** 本次扫描自动创建的专辑标题。 */
  albumsCreated: z.array(z.string()),
  /** 自动导入的新照片数。 */
  importedCount: z.number(),
  /** 网盘侧缺失的站内照片。 */
  missing: z.array(netdiskMissingPhotoSchema),
  error: z.string().nullable(),
});
export type NetdiskScanReport = z.infer<typeof netdiskScanReportSchema>;

/** 网盘同步状态（设置页一张卡片展示全部信息）。 */
export const netdiskStatusSchema = z.object({
  appConfigured: z.boolean(),
  connected: z.boolean(),
  dailyScan: z.boolean(),
  /** 已同步到网盘的照片数。 */
  syncedCount: z.number(),
  totalPhotos: z.number(),
  pendingDeletes: z.array(netdiskPendingDeleteSchema),
  /** 推送失败（重试耗尽）的照片列表。 */
  pushFailures: z.array(netdiskPushFailureSchema),
  scanReport: netdiskScanReportSchema.nullable(),
});
export type NetdiskStatus = z.infer<typeof netdiskStatusSchema>;

/** 手动触发下行扫描的响应。 */
export const netdiskScanTriggeredSchema = z.object({
  queued: z.boolean(),
});
export type NetdiskScanTriggered = z.infer<typeof netdiskScanTriggeredSchema>;

/** 缺失/推送失败照片一键重推（清旧映射后复用既有 push 管线）。 */
export const netdiskRepushInputSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1).max(2000),
});
export type NetdiskRepushInput = z.infer<typeof netdiskRepushInputSchema>;

export const netdiskRepushResultSchema = z.object({
  queued: z.number(),
});
export type NetdiskRepushResult = z.infer<typeof netdiskRepushResultSchema>;
