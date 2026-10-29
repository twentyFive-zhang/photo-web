import { createHash } from "node:crypto";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type { NetdiskScanReport } from "@photo/shared";
import { netdiskScanReportSchema } from "@photo/shared";
import type { Queue } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import {
  BAIDU_CHUNK_SIZE,
  BaiduApiError,
  BaiduApiService,
} from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
import type { Env } from "../config/env.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { StorageService } from "../storage/storage.service.js";
import { netdiskFilename, sanitizeNetdiskName } from "./netdisk-paths.js";

/** 网盘同步队列任务类型。 */
export type NetdiskJobPayload =
  | { type: "push"; photoId: string }
  | { type: "scan"; source: "daily" | "manual" }
  | { type: "move"; photoId: string; destAlbumTitle: string }
  | {
      type: "renameAlbum";
      albumId: string;
      oldTitle: string;
      newTitle: string;
    };

const BULL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: true,
};

/** 全量推送单次上限（个人站规模远达不到，防误触失控）。 */
const MAX_PUSH_ALL = 2000;

/** 全量推送进行中的内存标记（单进程，重启用 DB 数据自愈）。 */
type PushAllState = { queued: number; done: number; failed: number };

/**
 * 网盘镜像同步编排：
 * - 上行：push（单张）/ pushAll（存量回填），三阶段上传后回写 netdiskFsId/netdiskPath
 * - 下行：scan（增量导入 + 缺失报告）
 * - 传播：move / renameAlbum（删除不自动传播，见 ADR 0002）
 */
@Injectable()
export class NetdiskSyncService implements OnModuleInit {
  private readonly logger = new Logger(NetdiskSyncService.name);
  /** 应用目录（/apps/{应用名}）解析缓存。 */
  private appDirCache: { dir: string; resolvedAt: number } | null = null;
  private pushAllState: PushAllState | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly baiduApi: BaiduApiService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly credentials: BaiduCredentialService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly storage: StorageService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly config: ConfigService<Env, true>,
    @InjectQueue("netdisk-sync")
    private readonly queue: Queue<NetdiskJobPayload>,
  ) {}

  /** 启动时注册每日凌晨扫描的 repeatable 任务（实际执行时再检查开关）。 */
  async onModuleInit(): Promise<void> {
    await this.enqueueDailyScanRepeatable();
  }

  /** 新照片入队上行推送；未连接网盘时静默跳过（netdiskFsId 留空，全量推送兜底）。 */
  async enqueuePush(photoId: string): Promise<void> {
    if (!(await this.credentials.isConnected())) {
      return;
    }
    await this.queue.add(
      "netdisk-sync",
      { type: "push", photoId },
      { ...BULL_JOB_OPTIONS, jobId: `push-${photoId}` },
    );
  }

  /** 照片换专辑后的网盘移动入队（只针对已镜像的照片）。 */
  async enqueueMoves(
    entries: { photoId: string; destAlbumTitle: string }[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.queue.addBulk(
      entries.map((entry) => ({
        name: "netdisk-sync",
        data: { type: "move" as const, ...entry },
        opts: BULL_JOB_OPTIONS,
      })),
    );
  }

  /** 专辑重命名后的网盘目录重命名入队。 */
  async enqueueRenameAlbum(input: {
    albumId: string;
    oldTitle: string;
    newTitle: string;
  }): Promise<void> {
    await this.queue.add(
      "netdisk-sync",
      { type: "renameAlbum", ...input },
      BULL_JOB_OPTIONS,
    );
  }

  /** 站内删除 → 网盘删除待人工确认（幂等：同 fsid 只记一条）。 */
  async markPendingDeletes(
    entries: {
      netdiskFsId: string;
      netdiskPath: string | null;
      fallbackFilename: string;
      albumTitle: string;
    }[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.prisma.netdiskPendingDelete.upsert({
        where: { netdiskFsId: entry.netdiskFsId },
        update: {},
        create: {
          netdiskFsId: entry.netdiskFsId,
          path: entry.netdiskPath ?? "",
          filename: entry.netdiskPath
            ? (entry.netdiskPath.split("/").pop() ?? entry.fallbackFilename)
            : entry.fallbackFilename,
          albumTitle: entry.albumTitle,
        },
      });
    }
  }

  /** 按专辑补推：该专辑所有未同步照片入队（jobId 与单张推送相同，天然去重），返回入队数量。 */
  async enqueuePushAlbum(albumId: string): Promise<number> {
    if (!(await this.credentials.isConnected())) {
      return 0;
    }
    const photos = await this.prisma.photo.findMany({
      where: { albumId, netdiskFsId: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (photos.length === 0) {
      return 0;
    }
    await this.queue.addBulk(
      photos.map((photo) => ({
        name: "netdisk-sync",
        data: { type: "push" as const, photoId: photo.id },
        opts: { ...BULL_JOB_OPTIONS, jobId: `push-${photo.id}` },
      })),
    );
    return photos.length;
  }

  /** 存量回填：所有未同步照片入队。进行中返回 null。 */
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
        opts: BULL_JOB_OPTIONS,
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
      albumsCreated: [],
      importedCount: 0,
      missing: [],
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
   * 解析应用目录 /apps/{应用名}：list /apps 取第一个目录（个人账号一个应用一个目录）。
   * 结果缓存 5 分钟；目录还没建时抛错（用户需先在网盘建 /我的应用数据/{应用名}/）。
   */
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
   * 上行推送单张照片（push 任务的执行体）：
   * 读原件 → 整体/首片/分片 MD5 → precreate → 4MB 分片 superfile2 → create → 回写映射。
   * 已同步（netdiskFsId 已设）直接跳过——网盘导入回写与推送入队有竞态，这里兜底。
   */
  async pushPhoto(photoId: string): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: {
        id: true,
        publicId: true,
        title: true,
        originalKey: true,
        netdiskFsId: true,
        album: { select: { title: true } },
      },
    });
    if (!photo || photo.netdiskFsId) {
      return;
    }

    const appDir = await this.resolveAppDir();
    const destDir = `${appDir}/${sanitizeNetdiskName(photo.album.title)}`;
    const path = `${destDir}/${netdiskFilename(photo)}`;
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
        size: buffer.length,
        uploadid: pre.uploadid,
        blockList,
      });
    });

    await this.prisma.photo.update({
      where: { id: photoId },
      data: { netdiskFsId: String(fsId), netdiskPath: path },
    });
    if (this.pushAllState) {
      this.pushAllState.done += 1;
    }
    this.logger.log(`照片已推送网盘：${path}`);
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
