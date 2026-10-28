import { z } from "zod";

/** 站内已删除、网盘删除待人工确认的条目。 */
export const netdiskPendingDeleteSchema = z.object({
  id: z.string(),
  filename: z.string(),
  albumTitle: z.string(),
  createdAt: z.string(),
});
export type NetdiskPendingDelete = z.infer<typeof netdiskPendingDeleteSchema>;

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
  scanReport: netdiskScanReportSchema.nullable(),
});
export type NetdiskStatus = z.infer<typeof netdiskStatusSchema>;

/** 手动触发下行扫描的响应。 */
export const netdiskScanTriggeredSchema = z.object({
  queued: z.boolean(),
});
export type NetdiskScanTriggered = z.infer<typeof netdiskScanTriggeredSchema>;
