import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type {
  NetdiskManagedFiles,
  NetdiskScanReport,
  NetdiskUploadTask,
  NetdiskUploadTasks,
} from "@photo/shared";
import {
  netdiskManagedFilesSchema,
  netdiskScanReportSchema,
} from "@photo/shared";
import type { Queue } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import {
  BAIDU_CHUNK_SIZE,
  BaiduApiError,
  BaiduApiService,
} from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
import { isMissingRecordError } from "../common/prisma-errors.js";
import type { Env } from "../config/env.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { StorageService } from "../storage/storage.service.js";
import {
  NETDISK_LIBRARY_DIR,
  netdiskLibraryFilename,
} from "./netdisk-paths.js";

/** 待导入文件在扫描报告中的明细展示上限（全量看 pendingCount）。 */
export const PENDING_FILES_REPORT_LIMIT = 200;

/** 网盘同步队列任务类型。 */
export type NetdiskJobPayload =
  | { type: "push"; photoId: string }
  | { type: "scan"; source: "daily" | "manual" }
  | {
      /** 托管文件直接上传（临时文件已落盘，分片推百度；ADR 0004）。 */
      type: "uploadManaged";
      taskId: string;
      tempPath: string;
      destPath: string;
      filename: string;
      size: number;
    };

const BULL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: true,
};

/**
 * 托管上传任务专用选项：完成/失败的任务保留 7 天（页面上看「最近任务状态」），
 * 但限 500 条防失控；照片推送类任务依旧即时清理（它们的可见性走 DB）。
 */
const MANAGED_UPLOAD_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * push 任务专用选项：最终失败的任务从 failed 集合移除（removeOnFail）。
 * 失败可见性由 worker 事件落库（NetdiskPushFailure），不依赖 failed 里的任务体；
 * 而 failed 残留任务会以同 jobId 静默吞掉后续补推（JIANGLIUER-24）。
 */
const PUSH_JOB_OPTIONS = {
  ...BULL_JOB_OPTIONS,
  removeOnFail: true,
};

/** 全量推送单次上限（个人站规模远达不到，防误触失控）。 */
const MAX_PUSH_ALL = 2000;

/** 全量推送进行中的内存标记（单进程，重启用 DB 数据自愈）。 */
type PushAllState = { queued: number; done: number; failed: number };

/**
 * 网盘母版同步编排（ADR 0005 母版权威 + ADR 0006 目录解耦）：
 * - 上行：push（单张）/ pushAll（存量回填），落点统一 /apps/{应用名}/library/
 *   （publicId 命名），三阶段上传成功后回写 fsid 索引并删除本地暂存原件
 * - 下行：scan（发现待导入文件 + 按 fsId 刷新路径缓存 + 母本丢失告警），
 *   不建专辑、不自动导入
 * - 托管文件直传（ADR 0004）：与照片流程无关的直接管理通道
 * - 删除不变量：站内删除不碰网盘；网盘文件永不删除，脱离索引即回待导入
 */
@Injectable()
export class NetdiskSyncService implements OnModuleInit {
  private readonly logger = new Logger(NetdiskSyncService.name);
  /** 应用目录（/apps/{应用名}）解析缓存。 */
  private appDirCache: { dir: string; resolvedAt: number } | null = null;
  private pushAllState: PushAllState | null = null;
  /** 托管文件登记（SiteSetting JSON 列）读改写的进程内串行化。 */
  private managedLock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly baiduApi: BaiduApiService,
    private readonly credentials: BaiduCredentialService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue("netdisk-sync")
    private readonly queue: Queue<NetdiskJobPayload>,
  ) {}

  /** 启动时注册每日凌晨扫描的 repeatable 任务（实际执行时再检查开关）。 */
  async onModuleInit(): Promise<void> {
    await this.enqueueDailyScanRepeatable();
  }

  /**
   * 新照片入队上行推送；未连接网盘时静默跳过（netdiskFsId 留空，全量推送兜底）。
   * 只在上传创建后调用（photoId 全新），不存在历史同 jobId 任务，无需清理 failed。
   */
  async enqueuePush(photoId: string): Promise<void> {
    if (!(await this.credentials.isConnected())) {
      return;
    }
    await this.queue.add(
      "netdisk-sync",
      { type: "push", photoId },
      { ...PUSH_JOB_OPTIONS, jobId: `push-${photoId}` },
    );
  }

  /**
   * ---------- 托管文件（ADR 0004 直接上传通道） ----------
   *
   * 托管文件不进 Photo 表、不进专辑；仅在 SiteSetting.netdiskManagedFiles
   * 登记 fsId/path，供下行扫描跳过。唯一来源：管理员在网盘管理页直接上传
   * 的任意格式文件（ADR 0006 后「站内删除转托管归档」语义退役——删除照片
   * 只移除索引，文件回到待导入状态）。登记随扫描自愈修剪（网盘上已不存在
   * 的条目清除），页内删除时按路径同步移除。
   */

  /** 托管登记读改写串行化（单进程内互斥；跨进程无并发写入方）。 */
  private withManagedLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.managedLock.then(fn, fn);
    this.managedLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 读托管登记（JSON 损坏视为空，不阻塞照片流程）。 */
  private async readManagedFiles(): Promise<NetdiskManagedFiles> {
    const setting = await this.prisma.siteSetting.findUnique({
      where: { id: "singleton" },
      select: { netdiskManagedFiles: true },
    });
    const parsed = netdiskManagedFilesSchema.safeParse(
      setting?.netdiskManagedFiles,
    );
    return parsed.success ? parsed.data : { entries: [] };
  }

  private async writeManagedFiles(files: NetdiskManagedFiles): Promise<void> {
    await this.prisma.siteSetting.upsert({
      where: { id: "singleton" },
      update: { netdiskManagedFiles: files },
      create: { id: "singleton", netdiskManagedFiles: files },
    });
  }

  /** 上传成功后登记托管文件（同 fsId 幂等，覆盖更新 path）。 */
  async addManagedEntry(entry: { fsId: string; path: string }): Promise<void> {
    await this.withManagedLock(async () => {
      const files = await this.readManagedFiles();
      const rest = files.entries.filter((item) => item.fsId !== entry.fsId);
      await this.writeManagedFiles({
        entries: [...rest, { ...entry, uploadedAt: new Date().toISOString() }],
      });
    });
  }

  /** 托管登记清单（设置页「托管文件」展示）。 */
  async listManagedFiles(): Promise<NetdiskManagedFiles> {
    return this.readManagedFiles();
  }

  /** 按 path 移除托管登记（文件精确匹配 + 目录前缀匹配），返回移除条数。 */
  async removeManagedEntriesByPaths(paths: string[]): Promise<number> {
    if (paths.length === 0) {
      return 0;
    }
    return this.withManagedLock(async () => {
      const files = await this.readManagedFiles();
      const prefixes = paths.map((path) => `${path}/`);
      const kept = files.entries.filter(
        (entry) =>
          !paths.includes(entry.path) &&
          !prefixes.some((prefix) => entry.path.startsWith(prefix)),
      );
      if (kept.length !== files.entries.length) {
        await this.writeManagedFiles({ entries: kept });
      }
      return files.entries.length - kept.length;
    });
  }

  /** 扫描后自愈：网盘上已不存在的托管登记清除。 */
  async pruneManagedEntries(seenFsIds: Set<string>): Promise<void> {
    await this.withManagedLock(async () => {
      const files = await this.readManagedFiles();
      const kept = files.entries.filter((entry) => seenFsIds.has(entry.fsId));
      if (kept.length !== files.entries.length) {
        await this.writeManagedFiles({ entries: kept });
      }
    });
  }

  /** 下行扫描用：当前托管文件 fsId 集合（这些文件不进任何照片流程）。 */
  async listManagedFsIds(): Promise<Set<string>> {
    const files = await this.readManagedFiles();
    return new Set(files.entries.map((entry) => entry.fsId));
  }

  /**
   * 删除网盘条目（单/批/夹通用）后的索引联动：路径精确匹配或目录前缀
   * 匹配的照片清 netdiskFsId/netdiskPath（变回「未同步」，暂存原件仍在的
   * 可全量推送恢复）。托管登记由调用方按需另行处理。
   */
  async clearMirrorMappings(paths: string[]): Promise<number> {
    if (paths.length === 0) {
      return 0;
    }
    const conditions = paths.flatMap((path) => [
      { netdiskPath: path },
      { netdiskPath: { startsWith: `${path}/` } },
    ]);
    const result = await this.prisma.photo.updateMany({
      where: { netdiskFsId: { not: null }, OR: conditions },
      data: { netdiskFsId: null, netdiskPath: null },
    });
    return result.count;
  }

  /** 托管文件上传入队：临时文件路径入 BullMQ，页面上看任务状态。 */
  async enqueueManagedUpload(input: {
    taskId: string;
    tempPath: string;
    destPath: string;
    filename: string;
    size: number;
  }): Promise<void> {
    await this.queue.add(
      "netdisk-sync",
      { type: "uploadManaged", ...input },
      {
        ...MANAGED_UPLOAD_JOB_OPTIONS,
        jobId: `managed-upload-${input.taskId}`,
      },
    );
  }

  /** 托管上传任务视图（最近 50 条，页面轮询「后台上传中」状态）。 */
  async listManagedUploads(): Promise<NetdiskUploadTasks> {
    const jobs = await this.queue.getJobs(
      ["active", "waiting", "delayed", "failed", "completed"],
      0,
      99,
    );
    const tasks: NetdiskUploadTask[] = [];
    for (const job of jobs) {
      if (job.data.type !== "uploadManaged") {
        continue;
      }
      const state = await job.getState();
      tasks.push({
        id: job.id ?? "",
        filename: job.data.filename,
        destPath: job.data.destPath,
        size: job.data.size,
        state:
          state === "active"
            ? "active"
            : state === "completed"
              ? "completed"
              : state === "failed"
                ? "failed"
                : "waiting",
        progress: typeof job.progress === "number" ? job.progress : 0,
        error: job.failedReason ?? null,
        createdAt: new Date(job.timestamp).toISOString(),
      });
    }
    tasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { tasks: tasks.slice(0, 50) };
  }

  /**
   * 托管文件上传执行体（uploadManaged 任务）：
   * 流式算分片 MD5 → precreate → 4MB 分片 superfile2 → create →
   * 登记托管条目。成功后清理临时文件；失败保留供重试，最终失败由
   * processor 清理。onProgress 上报分片进度（页面任务列表展示）。
   */
  async uploadManagedFile(
    input: {
      tempPath: string;
      destPath: string;
      size: number;
    },
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const handle = await open(input.tempPath, "r").catch(() => {
      throw new Error("上传临时文件已不存在，请重新上传");
    });

    try {
      // 分片 MD5 + 整体/首 256KB MD5（秒传探测参数，与照片推送同参数）
      const chunk = Buffer.alloc(BAIDU_CHUNK_SIZE);
      const blockList: string[] = [];
      const contentHash = createHash("md5");
      for (let offset = 0; offset < input.size; offset += BAIDU_CHUNK_SIZE) {
        const { bytesRead } = await handle.read(
          chunk,
          0,
          BAIDU_CHUNK_SIZE,
          offset,
        );
        if (bytesRead === 0) {
          throw new Error("临时文件内容比登记大小短，请重新上传");
        }
        const slice = chunk.subarray(0, bytesRead);
        blockList.push(createHash("md5").update(slice).digest("hex"));
        contentHash.update(slice);
      }
      const contentMd5 = contentHash.digest("hex");
      const head = Buffer.alloc(Math.min(input.size, 256 * 1024));
      await handle.read(head, 0, head.length, 0);
      const sliceMd5 = createHash("md5").update(head).digest("hex");

      const fsId = await this.credentials.withAccessToken(async (token) => {
        const pre = await this.baiduApi.precreate(token, {
          path: input.destPath,
          size: input.size,
          blockList,
          contentMd5,
          sliceMd5,
        });
        const host = await this.baiduApi.locateupload(
          token,
          input.destPath,
          pre.uploadid,
        );
        for (let seq = 0; seq < blockList.length; seq++) {
          const { bytesRead } = await handle.read(
            chunk,
            0,
            BAIDU_CHUNK_SIZE,
            seq * BAIDU_CHUNK_SIZE,
          );
          if (bytesRead === 0) {
            break;
          }
          if (bytesRead < BAIDU_CHUNK_SIZE && seq !== blockList.length - 1) {
            throw new Error("临时文件内容与登记大小不一致，请重新上传");
          }
          await this.baiduApi.superfile2(token, {
            host,
            path: input.destPath,
            uploadid: pre.uploadid,
            partseq: seq,
            chunk: chunk.subarray(0, bytesRead),
          });
          onProgress?.(Math.round(((seq + 1) / blockList.length) * 100));
        }
        const created = await this.baiduApi.create(token, {
          path: input.destPath,
          isdir: false,
          size: input.size,
          uploadid: pre.uploadid,
          blockList,
        });
        if (created === null) {
          throw new BaiduApiError("提交上传未返回 fs_id", -1);
        }
        return created;
      });

      await this.addManagedEntry({
        fsId: String(fsId),
        path: input.destPath,
      });
      this.logger.log(`托管文件已上传网盘：${input.destPath}`);
    } finally {
      await handle.close();
    }
    await unlink(input.tempPath).catch(() => undefined);
  }

  /**
   * 只删除停在 failed 集合的旧 push 任务：同 jobId 已存在时 addBulk 会被
   * 静默去重，failed 任务不删则永远推不动；等待/延迟/活跃中的任务保留
   * （去重即可，它会正常执行或重试）。历史版本未设 removeOnFail，failed
   * 集合里可能残留旧任务，入队前仍需显式清理（JIANGLIUER-24）。
   */
  private async removeFailedPushJobs(photoIds: string[]): Promise<void> {
    for (const photoId of photoIds) {
      const existing = await this.queue.getJob(`push-${photoId}`);
      if (existing && (await existing.isFailed())) {
        await existing.remove().catch(() => undefined);
      }
    }
  }

  /**
   * 站内删除时移除对应照片的上行推送任务（竞态第一道闸）：
   * 等待/延迟中的 push-${photoId} 任务直接删——照片已删，推上去只会留下
   * 无映射的孤儿文件。正在分片上传中的活跃任务不硬拆（可能已上传大半），
   * 交给 pushPhoto 回写的 P2025 兜底记录日志（第二道闸；文件脱离索引后
   * 由扫描回收到待导入清单，重新导入即恢复）。
   */
  async removeQueuedPushJobs(photoIds: string[]): Promise<void> {
    for (const photoId of photoIds) {
      const job = await this.queue.getJob(`push-${photoId}`);
      if (!job) {
        continue;
      }
      const state = await job.getState();
      if (state === "waiting" || state === "delayed") {
        await job.remove().catch(() => undefined);
      }
    }
  }

  /**
   * 推送失败照片重推：清掉旧映射与失败记录后复用既有 push 管线
   * （jobId 与单张推送相同，天然去重；推送成功后 netdiskFsId 重新回写）。
   * 仅适用于推送失败的照片——其暂存原件仍在本地，可重试；网盘侧母版丢失
   * 的照片本地无原件，不可重推（设置页只告警，ADR 0005）。
   * 入队前先清理停在 failed 集合的旧任务（见 removeFailedPushJobs）。
   * 返回实际入队数量。
   */
  async enqueueRepush(photoIds: string[]): Promise<number> {
    if (!(await this.credentials.isConnected())) {
      return 0;
    }
    const photos = await this.prisma.photo.findMany({
      where: { id: { in: photoIds } },
      select: { id: true },
    });
    if (photos.length === 0) {
      return 0;
    }
    const ids = photos.map((photo) => photo.id);
    await this.removeFailedPushJobs(ids);
    await this.prisma.photo.updateMany({
      where: { id: { in: ids } },
      data: { netdiskFsId: null, netdiskPath: null },
    });
    await this.prisma.netdiskPushFailure.deleteMany({
      where: { photoId: { in: ids } },
    });
    await this.queue.addBulk(
      photos.map((photo) => ({
        name: "netdisk-sync",
        data: { type: "push" as const, photoId: photo.id },
        opts: { ...PUSH_JOB_OPTIONS, jobId: `push-${photo.id}` },
      })),
    );
    return photos.length;
  }

  /**
   * 推送重试耗尽后的持久化失败记录（worker 在 final failure 时调用）。
   * 幂等：同照片重复失败覆盖更新（error/errno/attemptedAt 取最近一次）。
   */
  async recordPushFailure(photoId: string, error: unknown): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: { publicId: true, netdiskPath: true },
    });
    if (!photo) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const errno = error instanceof BaiduApiError ? error.errno : null;
    const filename = photo.netdiskPath?.split("/").pop() ?? photo.publicId;
    const data = {
      publicId: photo.publicId,
      filename,
      errno,
      error: message,
      attemptedAt: new Date(),
    };
    await this.prisma.netdiskPushFailure.upsert({
      where: { photoId },
      update: data,
      create: { photoId, ...data },
    });
    this.logger.warn(
      `推送网盘失败（重试耗尽）：${filename} errno=${errno ?? "-"} ${message}`,
    );
  }

  /** 清除推送失败记录：推送成功（或照片实际已同步）后调用。 */
  async clearPushFailures(photoIds: string[]): Promise<void> {
    if (photoIds.length === 0) {
      return;
    }
    await this.prisma.netdiskPushFailure.deleteMany({
      where: { photoId: { in: photoIds } },
    });
  }

  /**
   * 存量回填：所有未同步照片入队。进行中返回 null。
   * 不设自定义 jobId（BullMQ 走自增 id），不存在同 jobId 去重吞任务的问题；
   * removeOnFail 让失败任务不留残留（失败可见性走 DB 失败记录）。
   */
  async enqueuePushAll(): Promise<PushAllState | null> {
    if (this.pushAllState) {
      return null;
    }
    const photos = await this.prisma.photo.findMany({
      where: { netdiskFsId: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PUSH_ALL,
    });
    this.pushAllState = { queued: photos.length, done: 0, failed: 0 };
    await this.queue.addBulk(
      photos.map((photo) => ({
        name: "netdisk-sync",
        data: { type: "push" as const, photoId: photo.id },
        opts: PUSH_JOB_OPTIONS,
      })),
    );
    return this.pushAllState;
  }

  getPushAllState(): PushAllState | null {
    return this.pushAllState;
  }

  /** 注册每日凌晨 00:30 的可重复扫描任务（upsert 幂等；实际执行时再检查开关）。 */
  async enqueueDailyScanRepeatable(): Promise<void> {
    await this.queue.upsertJobScheduler(
      "netdisk-daily-scan",
      { pattern: "30 0 * * *" },
      {
        name: "netdisk-sync",
        data: { type: "scan", source: "daily" },
        opts: { removeOnComplete: true },
      },
    );
  }

  /** 手动触发下行扫描。扫描进行中返回 null。 */
  async enqueueScan(): Promise<{ queued: boolean } | null> {
    const report = await this.readScanReport();
    if (report?.status === "RUNNING") {
      return null;
    }
    await this.saveScanReport({
      status: "RUNNING",
      scannedAt: new Date().toISOString(),
      pendingCount: 0,
      pendingFiles: [],
      pathsRefreshed: 0,
      masterLost: [],
      error: null,
    });
    await this.queue.add(
      "netdisk-sync",
      { type: "scan", source: "manual" },
      {
        attempts: 1,
        removeOnComplete: true,
      },
    );
    return { queued: true };
  }

  /** 读最近扫描报告（Json 列经 schema 校验，损坏时视为 null）。 */
  async readScanReport(): Promise<NetdiskScanReport | null> {
    const setting = await this.prisma.siteSetting.findUnique({
      where: { id: "singleton" },
      select: { netdiskScanReport: true },
    });
    const parsed = netdiskScanReportSchema.safeParse(
      setting?.netdiskScanReport,
    );
    return parsed.success ? parsed.data : null;
  }

  async saveScanReport(report: NetdiskScanReport): Promise<void> {
    await this.prisma.siteSetting.upsert({
      where: { id: "singleton" },
      update: { netdiskScanReport: report },
      create: { id: "singleton", netdiskScanReport: report },
    });
  }

  /**
   * 解析应用目录 /apps/{应用名}。优先读 .env 的 BAIDU_APP_NAME（应用目录名即
   * 创建应用时填写的名称）；未配置时退回尝试列 /apps 虚拟根（部分账号不可列，
   * 会报 errno -9 → 提示补配置）。结果缓存 5 分钟。
   */
  async resolveAppDir(): Promise<string> {
    if (
      this.appDirCache &&
      Date.now() - this.appDirCache.resolvedAt < 5 * 60 * 1000
    ) {
      return this.appDirCache.dir;
    }
    const appName = this.config.get("BAIDU_APP_NAME", { infer: true });
    let dir: string;
    if (appName) {
      dir = `/apps/${appName}`;
      // 校验目录确实存在且可列
      await this.credentials.withAccessToken((token) =>
        this.baiduApi.list(token, dir, 1),
      );
    } else {
      const response = await this.credentials.withAccessToken((token) =>
        this.baiduApi.list(token, "/apps", 1),
      );
      dir = response.list?.find((entry) => entry.isdir === 1)?.path ?? "";
      if (!dir) {
        throw new BaiduApiError(
          "无法确定网盘应用目录：请在 .env 配置 BAIDU_APP_NAME（创建应用时填写的名称，即网盘 /我的应用数据/{应用名}/ 的目录名）",
          -9,
        );
      }
    }
    this.appDirCache = { dir, resolvedAt: Date.now() };
    return dir;
  }

  /**
   * 上行推送单张照片（push 任务的执行体，ADR 0006 统一落点）：
   * 读暂存原件 → 整体/首片/分片 MD5 → precreate → 4MB 分片 superfile2 →
   * create → 回写 fsid 索引 → 删除本地暂存原件（仅原件，变体保留）。
   * 落点固定 /apps/{应用名}/library/{publicId}.{ext}——目录名不再由专辑标题
   * 派生，library/ 下结构不承载任何系统语义（管理员可自由移动，扫描按 fsId
   * 刷新路径缓存）。
   * 已同步（netdiskFsId 已设）直接跳过——网盘导入回写与推送入队有竞态，这里兜底
   * （文件确实在网盘上，残留的失败记录一并清除）。
   */
  async pushPhoto(photoId: string): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: {
        id: true,
        publicId: true,
        originalKey: true,
        netdiskFsId: true,
      },
    });
    if (!photo || photo.netdiskFsId) {
      if (photo) {
        await this.clearPushFailures([photoId]);
        // 已镜像照片本地不应再有原件（权威在网盘，ADR 0005）：
        // 兜底清理残留的暂存原件（导入的照片该文件本就不存在，删除为空操作）
        await this.deleteStagedOriginal(photo.originalKey, photo.publicId);
      }
      // 无需再推也计入全量推送进度，否则 done+failed 追不上 queued、收尾不触发
      // （照片入队后被网盘导入或单张推送抢先同步时走这里）。
      if (this.pushAllState) {
        this.pushAllState.done += 1;
      }
      return;
    }

    const appDir = await this.resolveAppDir();
    // 统一母版落点：/apps/{应用名}/library/{publicId}.{ext}（ADR 0006）
    const path = `${appDir}/${NETDISK_LIBRARY_DIR}/${netdiskLibraryFilename({
      publicId: photo.publicId,
      originalKey: photo.originalKey,
    })}`;
    const buffer = await this.storage.get(photo.originalKey);

    // 分片 MD5 + 整体/首 256KB MD5（秒传探测参数，不依赖成功）
    const blockList: string[] = [];
    for (let offset = 0; offset < buffer.length; offset += BAIDU_CHUNK_SIZE) {
      blockList.push(
        createHash("md5")
          .update(buffer.subarray(offset, offset + BAIDU_CHUNK_SIZE))
          .digest("hex"),
      );
    }
    const contentMd5 = createHash("md5").update(buffer).digest("hex");
    const sliceMd5 = createHash("md5")
      .update(buffer.subarray(0, Math.min(buffer.length, 256 * 1024)))
      .digest("hex");

    const fsId = await this.credentials.withAccessToken(async (token) => {
      const pre = await this.baiduApi.precreate(token, {
        path,
        size: buffer.length,
        blockList,
        contentMd5,
        sliceMd5,
      });
      const host = await this.baiduApi.locateupload(token, path, pre.uploadid);
      for (let seq = 0; seq < blockList.length; seq++) {
        await this.baiduApi.superfile2(token, {
          host,
          path,
          uploadid: pre.uploadid,
          partseq: seq,
          chunk: buffer.subarray(
            seq * BAIDU_CHUNK_SIZE,
            Math.min((seq + 1) * BAIDU_CHUNK_SIZE, buffer.length),
          ),
        });
      }
      return this.baiduApi.create(token, {
        path,
        isdir: false,
        size: buffer.length,
        uploadid: pre.uploadid,
        blockList,
      });
    });
    if (fsId === null) {
      throw new BaiduApiError("提交上传未返回 fs_id", -1);
    }

    // 回写索引。竞态兜底：分片上传进行中照片被站内删除（P2025）→ 上传已
    // 成功、网盘上留下无索引文件——按 ADR 0006 删除不变量只记日志：文件在
    // 网盘原位保留，下轮扫描按「未被索引」回收到待导入清单，重新导入即恢复。
    try {
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { netdiskFsId: String(fsId), netdiskPath: path },
      });
    } catch (error) {
      if (!isMissingRecordError(error)) {
        throw error;
      }
      this.logger.warn(
        `照片上传完成前已被站内删除，网盘文件转入待导入状态：${path}`,
      );
    }
    await this.clearPushFailures([photoId]);
    // 首推成功即删本地暂存原件（仅原件，变体保留）——母版权威自此在网盘。
    // 若此时崩溃，重试会走上方已同步分支兜底清理。
    await this.deleteStagedOriginal(photo.originalKey, photo.publicId);
    if (this.pushAllState) {
      this.pushAllState.done += 1;
    }
    this.logger.log(`照片已推送网盘，本地暂存原件已清理：${path}`);
  }

  /**
   * 删除本地暂存原件（best-effort）：文件不存在忽略；其他删除失败只记日志
   * 不让推送报错——网盘上已有权威副本，本地残留可由全量推送/迁移命令再清理。
   */
  private async deleteStagedOriginal(
    originalKey: string,
    publicId: string,
  ): Promise<void> {
    try {
      await this.storage.deleteIfExists(originalKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `暂存原件删除失败（忽略，网盘已有权威副本）：photos/${publicId}/ → ${message}`,
      );
    }
  }

  /** push 任务结束时统计全量推送进度（单张推送时无副作用）。 */
  onPushFailed(): void {
    if (this.pushAllState) {
      this.pushAllState.failed += 1;
    }
  }

  /** 全量推送收尾：清内存标记（进度可从 DB 的 syncedCount 实时算）。 */
  finishPushAll(): void {
    this.pushAllState = null;
  }
}
