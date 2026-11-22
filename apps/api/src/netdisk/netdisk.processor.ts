import { unlink } from "node:fs/promises";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { NetdiskMasterLostPhoto, NetdiskPendingFile } from "@photo/shared";
import type { Job } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiService } from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
import { isImportableImage } from "../import/import.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
import type { NetdiskJobPayload } from "./netdisk-sync.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import {
  NetdiskSyncService,
  PENDING_FILES_REPORT_LIMIT,
} from "./netdisk-sync.service.js";

/** 百度 list 单页条数（与 API 分页一致）。 */
const SCAN_WALK_PAGE = 100;

type PushPayload = Extract<NetdiskJobPayload, { type: "push" }>;
type UploadManagedPayload = Extract<
  NetdiskJobPayload,
  { type: "uploadManaged" }
>;

/**
 * 网盘同步 worker：push（上行三阶段上传，落点 library/）/ scan（下行：
 * 待导入发现 + 路径缓存刷新 + 母本丢失告警）/ uploadManaged（托管文件
 * 直传，ADR 0004）。ADR 0006 后扫描不建专辑、不自动导入；move/rename
 * 传播已随目录解耦退役。
 * 每日扫描的 repeatable 任务由 NetdiskSyncService 注册。
 */
@Processor("netdisk-sync", { concurrency: 2 })
export class NetdiskProcessor extends WorkerHost {
  private readonly logger = new Logger(NetdiskProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baiduApi: BaiduApiService,
    private readonly credentials: BaiduCredentialService,
    private readonly sync: NetdiskSyncService,
  ) {
    super();
  }

  async process(job: Job<NetdiskJobPayload>): Promise<void> {
    switch (job.data.type) {
      case "push":
        return this.runPush(job as Job<PushPayload>);
      case "scan":
        return this.runScan(job.data.source);
      case "uploadManaged":
        return this.runManagedUpload(job as Job<UploadManagedPayload>);
    }
  }

  /**
   * push 任务重试耗尽（Bull failed 事件、attempts 用尽）→ 失败落库，
   * admin 可见；不再只留 stdout。failed 事件在 moveToFailed 之后触发，
   * attemptsMade 已含本次失败，故 `attemptsMade >= attempts` 即最终失败。
   */
  @OnWorkerEvent("failed")
  onPushFailedFinal(
    job: Job<NetdiskJobPayload> | undefined,
    error: Error,
  ): void {
    if (
      job?.data.type !== "push" ||
      job.attemptsMade < (job.opts.attempts ?? 1)
    ) {
      return;
    }
    const photoId = job.data.photoId;
    this.sync.recordPushFailure(photoId, error).catch((recordError) => {
      this.logger.error(
        `推送失败记录落库失败 photoId=${photoId}: ${recordError instanceof Error ? recordError.message : recordError}`,
      );
    });
  }

  private async runPush(job: Job<PushPayload>): Promise<void> {
    try {
      await this.sync.pushPhoto(job.data.photoId);
    } catch (error) {
      // process 抛错时 moveToFailed 尚未执行，attemptsMade 不含本次失败：
      // +1 后等于 attempts 即重试耗尽的最终失败。每次尝试都计数会让 pushAll
      // 的 failed 虚高数倍、提前触发收尾。
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        this.sync.onPushFailed();
      }
      throw error;
    } finally {
      const state = this.sync.getPushAllState();
      if (state && state.done + state.failed >= state.queued) {
        this.sync.finishPushAll();
        this.logger.log(
          `全量推送完成：成功 ${state.done}，失败 ${state.failed}`,
        );
      }
    }
  }

  /** 托管文件直传：进度上报给任务（页面轮询展示），成功后清临时文件。 */
  private async runManagedUpload(
    job: Job<UploadManagedPayload>,
  ): Promise<void> {
    await this.sync.uploadManagedFile(job.data, (percent) => {
      void job.updateProgress(percent).catch(() => undefined);
    });
  }

  /**
   * 托管上传最终失败：清理临时文件（重试期间保留，磁盘占着 2GB 不合适）。
   * 任务状态与错误已留存在 BullMQ failed 记录里（removeOnFail 7 天）。
   */
  @OnWorkerEvent("failed")
  onManagedUploadFailedFinal(
    job: Job<NetdiskJobPayload> | undefined,
    error: Error,
  ): void {
    if (
      job?.data.type !== "uploadManaged" ||
      job.attemptsMade < (job.opts.attempts ?? 1)
    ) {
      return;
    }
    this.logger.warn(
      `托管文件上传失败（重试耗尽）：${job.data.filename} ${error.message}`,
    );
    unlink(job.data.tempPath).catch(() => undefined);
  }

  // ---- 下行扫描 ----

  private async runScan(source: "daily" | "manual"): Promise<void> {
    // 每日任务：开关关闭或上次扫描仍在进行（24h 内）时跳过
    if (source === "daily") {
      const settings = await this.prisma.siteSetting.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      if (!settings.netdiskDailyScan) {
        return;
      }
      const report = await this.sync.readScanReport();
      if (
        report?.status === "RUNNING" &&
        Date.now() - new Date(report.scannedAt).getTime() < 24 * 3600 * 1000
      ) {
        return;
      }
    }

    try {
      await this.walkAndIndex();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "未知错误（扫描失败）";
      this.logger.warn(`网盘扫描失败: ${message}`);
      await this.sync.saveScanReport({
        status: "FAILED",
        scannedAt: new Date().toISOString(),
        pendingCount: 0,
        pendingFiles: [],
        pathsRefreshed: 0,
        masterLost: [],
        error: message,
      });
    }
  }

  /**
   * 遍历 /apps/{应用名}/ 全树（ADR 0006 扫描降级，只做三件事）：
   * 1. 发现待导入文件（未被任何照片索引、不在托管清单的图片）→ 报告待导入清单；
   * 2. 按 fsId 刷新已索引照片的 netdiskPath 缓存（管理员在网盘 App 内自由
   *    移动/改名后，照片↔文件映射不丢）；
   * 3. 报告母本丢失（已索引 fsid 本次未出现在网盘）。
   */
  private async walkAndIndex(): Promise<void> {
    await this.sync.saveScanReport({
      status: "RUNNING",
      scannedAt: new Date().toISOString(),
      pendingCount: 0,
      pendingFiles: [],
      pathsRefreshed: 0,
      masterLost: [],
      error: null,
    });

    const appDir = await this.sync.resolveAppDir();
    const known = await this.prisma.photo.findMany({
      where: { netdiskFsId: { not: null } },
      select: {
        id: true,
        publicId: true,
        netdiskFsId: true,
        netdiskPath: true,
      },
    });
    const knownFsIds = new Set(known.map((photo) => photo.netdiskFsId ?? ""));

    // fsId → 当前网盘路径（本次 walk 看到的全部文件）
    const seen = new Map<string, string>();
    await this.walk(appDir, seen);

    // 托管文件登记自愈（网盘上已不存在的登记清除）
    await this.sync.pruneManagedEntries(new Set(seen.keys()));
    const managedFsIds = await this.sync.listManagedFsIds();

    // 1. 待导入文件：未被照片索引、不在托管清单的图片
    const pendingFiles: NetdiskPendingFile[] = [];
    for (const [fsId, path] of seen) {
      if (knownFsIds.has(fsId) || managedFsIds.has(fsId)) {
        continue;
      }
      const filename = path.split("/").pop() ?? path;
      if (!isImportableImage(filename, null)) {
        continue;
      }
      pendingFiles.push({
        fsId,
        path,
        filename,
        // size 仅用于展示与导入入参占位；精确值在导入时由网盘返回，这里置 0
        size: 0,
      });
    }

    // 2. 路径缓存刷新：按 fsId 对照，netdiskPath 变了就更新（目录结构无语义，
    //    缓存只服务展示与删除联动的路径匹配）
    let pathsRefreshed = 0;
    for (const photo of known) {
      const currentPath = photo.netdiskFsId
        ? seen.get(photo.netdiskFsId)
        : undefined;
      if (currentPath && currentPath !== photo.netdiskPath) {
        await this.prisma.photo.update({
          where: { id: photo.id },
          data: { netdiskPath: currentPath },
        });
        pathsRefreshed += 1;
      }
    }

    // 3. 母本丢失告警（ADR 0005）：站内已索引的 fsid 本次未出现在网盘 →
    //    本地按「首推成功即删」也无原件，母版唯一权威副本丢失，仅告警不可自动修复
    const masterLost: NetdiskMasterLostPhoto[] = known
      .filter((photo) => !seen.has(photo.netdiskFsId ?? ""))
      .map((photo) => ({
        photoId: photo.id,
        publicId: photo.publicId,
        filename: photo.netdiskPath?.split("/").pop() ?? photo.publicId,
      }));

    await this.sync.saveScanReport({
      status: "DONE",
      scannedAt: new Date().toISOString(),
      pendingCount: pendingFiles.length,
      pendingFiles: pendingFiles.slice(0, PENDING_FILES_REPORT_LIMIT),
      pathsRefreshed,
      masterLost,
      error: null,
    });
    this.logger.log(
      `网盘扫描完成：待导入 ${pendingFiles.length} 个，路径缓存刷新 ${pathsRefreshed} 条，母本丢失 ${masterLost.length} 张`,
    );
  }

  /** 递归遍历目录（分页），记录全部文件的 fsid → 路径。 */
  private async walk(dir: string, seen: Map<string, string>): Promise<void> {
    for (let page = 1; ; page++) {
      const response = await this.credentials.withAccessToken((token) =>
        this.baiduApi.list(token, dir, page),
      );
      for (const entry of response.list ?? []) {
        seen.set(String(entry.fs_id), entry.path);
        if (entry.isdir === 1) {
          await this.walk(entry.path, seen);
        }
      }
      if ((response.list ?? []).length < SCAN_WALK_PAGE) {
        break;
      }
    }
  }
}
