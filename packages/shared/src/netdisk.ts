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

// ---------- 网盘直接管理（新建/删除/直接上传，JIANGLIUER-94） ----------

/** 新建文件夹输入：dir 为父目录（空串 = 应用根），name 为新文件夹名。 */
export const netdiskCreateFolderInputSchema = z.object({
  dir: z.string().default(""),
  name: z.string().min(1, "文件夹名称不能为空").max(100, "文件夹名称过长"),
});
export type NetdiskCreateFolderInput = z.infer<
  typeof netdiskCreateFolderInputSchema
>;

export const netdiskCreateFolderResultSchema = z.object({
  path: z.string(),
});
export type NetdiskCreateFolderResult = z.infer<
  typeof netdiskCreateFolderResultSchema
>;

/**
 * 删除输入：单删/批删/文件夹级联共用一个路径数组。
 * 文件夹传目录路径本身（网盘侧递归删除，进回收站）。
 */
export const netdiskDeleteInputSchema = z.object({
  paths: z
    .array(z.string().min(1, "路径不能为空"))
    .min(1, "至少选择一个要删除的条目")
    .max(500, "单次最多删除 500 项"),
});
export type NetdiskDeleteInput = z.infer<typeof netdiskDeleteInputSchema>;

export const netdiskDeleteResultSchema = z.object({
  /** 受理删除的路径数（百度 filemanager 为异步受理）。 */
  deleted: z.number(),
  /** 级联清除镜像映射（netdiskFsId/netdiskPath）的照片数。 */
  clearedPhotos: z.number(),
});
export type NetdiskDeleteResult = z.infer<typeof netdiskDeleteResultSchema>;

/** 直接上传的后台任务视图（BullMQ 任务状态，不入库）。 */
export const netdiskUploadTaskSchema = z.object({
  id: z.string(),
  filename: z.string(),
  destPath: z.string(),
  size: z.number(),
  state: z.enum(["waiting", "active", "completed", "failed"]),
  /** 0-100 分片上传进度（waiting/completed/failed 恒为 0）。 */
  progress: z.number(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type NetdiskUploadTask = z.infer<typeof netdiskUploadTaskSchema>;

export const netdiskUploadTasksSchema = z.object({
  tasks: z.array(netdiskUploadTaskSchema),
});
export type NetdiskUploadTasks = z.infer<typeof netdiskUploadTasksSchema>;

/** 直接上传受理响应：taskId 用于在任务列表中对照。 */
export const netdiskUploadAcceptedSchema = z.object({
  taskId: z.string(),
});
export type NetdiskUploadAccepted = z.infer<typeof netdiskUploadAcceptedSchema>;

/**
 * 托管文件登记（持久化在 SiteSetting.netdiskManagedFiles JSON 列）。
 * 下行扫描据此跳过托管文件（不入 Photo 表、不进相册）；
 * scannedAt 由扫描用 seen 集合自愈修剪，uploadedAt 便于人工排查。
 */
export const netdiskManagedFilesSchema = z.object({
  entries: z.array(
    z.object({
      fsId: z.string(),
      path: z.string(),
      uploadedAt: z.string(),
    }),
  ),
});
export type NetdiskManagedFiles = z.infer<typeof netdiskManagedFilesSchema>;
