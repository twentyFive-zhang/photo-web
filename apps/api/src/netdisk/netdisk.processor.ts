import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { NetdiskMissingPhoto } from "@photo/shared";
import type { Job, Queue } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiError, BaiduApiService } from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
import { generatePublicId, generateShareToken } from "../common/id.js";
import {
  isImportableImage,
  MAX_ITEMS_PER_JOB,
} from "../import/import.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
import { sanitizeNetdiskName } from "./netdisk-paths.js";
import type { NetdiskJobPayload } from "./netdisk-sync.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { NetdiskSyncService } from "./netdisk-sync.service.js";

const IMPORT_BULL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: true,
};

type PushPayload = Extract<NetdiskJobPayload, { type: "push" }>;
type MovePayload = Extract<NetdiskJobPayload, { type: "move" }>;
type RenamePayload = Extract<NetdiskJobPayload, { type: "renameAlbum" }>;

/**
 * 网盘同步 worker：push（上行三阶段上传）/ scan（下行增量 + 缺失报告）/
 * move / renameAlbum（改名与换专辑传播）。删除不自动传播（ADR 0002）。
 * 每日扫描的 repeatable 任务由 NetdiskSyncService 注册。
 */
@Processor("netdisk-sync", { concurrency: 2 })
export class NetdiskProcessor extends WorkerHost {
  private readonly logger = new Logger(NetdiskProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly baiduApi: BaiduApiService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly credentials: BaiduCredentialService,
    private readonly sync: NetdiskSyncService,
    @InjectQueue("import") private readonly importQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<NetdiskJobPayload>): Promise<void> {
    switch (job.data.type) {
      case "push":
        return this.runPush(job as Job<PushPayload>);
      case "scan":
        return this.runScan(job.data.source);
      case "move":
        return this.runMove(job.data as MovePayload);
      case "renameAlbum":
        return this.runRenameAlbum(job.data as RenamePayload);
    }
  }

  private async runPush(job: Job<PushPayload>): Promise<void> {
    try {
      await this.sync.pushPhoto(job.data.photoId);
    } catch (error) {
      this.sync.onPushFailed();
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
      await this.walkAndImport();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "未知错误（扫描失败）";
      this.logger.warn(`网盘扫描失败: ${message}`);
      await this.sync.saveScanReport({
        status: "FAILED",
        scannedAt: new Date().toISOString(),
        albumsCreated: [],
        importedCount: 0,
        missing: [],
        error: message,
      });
    }
  }

  /** 遍历 /apps/{应用名}/ 全树：新文件夹建专辑（仅链接可见）、新照片自动导入、对照缺失。 */
  private async walkAndImport(): Promise<void> {
    await this.sync.saveScanReport({
      status: "RUNNING",
      scannedAt: new Date().toISOString(),
      albumsCreated: [],
      importedCount: 0,
      missing: [],
      error: null,
    });

    const appDir = await this.sync.resolveAppDir();
    const known = await this.prisma.photo.findMany({
      where: { netdiskFsId: { not: null } },
      select: { netdiskFsId: true },
    });
    const knownFsIds = new Set(known.map((photo) => photo.netdiskFsId ?? ""));

    const seen = new Set<string>();
    const newFiles: {
      fsId: number;
      filename: string;
      dirName: string;
    }[] = [];
    await this.walk(appDir, seen, knownFsIds, newFiles);

    // 新文件按所在文件夹归到专辑（目录名 = 规范化后的专辑标题）
    const albums = await this.prisma.album.findMany({
      select: { id: true, title: true },
    });
    const byName = new Map(
      albums.map((a) => [sanitizeNetdiskName(a.title), a]),
    );
    const albumsCreated: string[] = [];
    const perAlbum = new Map<string, { fsId: number; filename: string }[]>();
    const appDirName = appDir.split("/").pop() ?? "";

    for (const file of newFiles) {
      // 应用根目录下的散文件没有专辑语义，跳过（报告中体现为不导入）
      if (file.dirName === appDirName) {
        continue;
      }
      let album = byName.get(file.dirName);
      if (!album) {
        album = await this.prisma.album.create({
          data: {
            publicId: generatePublicId(),
            shareToken: generateShareToken(),
            title: file.dirName,
            visibility: "UNLISTED",
          },
        });
        byName.set(file.dirName, album);
        albumsCreated.push(album.title);
      }
      const batch = perAlbum.get(album.id) ?? [];
      batch.push({ fsId: file.fsId, filename: file.filename });
      perAlbum.set(album.id, batch);
    }

    // 按专辑分批创建导入任务（复用 M5 的 import 队列，成功后回写 netdiskFsId）
    let importedCount = 0;
    for (const [albumId, files] of perAlbum) {
      for (let i = 0; i < files.length; i += MAX_ITEMS_PER_JOB) {
        const batch = files.slice(i, i + MAX_ITEMS_PER_JOB);
        const job = await this.prisma.importJob.create({
          data: {
            source: "BAIDU",
            albumId,
            total: batch.length,
            items: {
              createMany: {
                data: batch.map((file) => ({
                  sourceFileId: String(file.fsId),
                  filename: file.filename,
                })),
              },
            },
          },
        });
        await this.importQueue.add(
          "import",
          { importJobId: job.id },
          IMPORT_BULL_JOB_OPTIONS,
        );
        importedCount += batch.length;
      }
    }

    // 网盘侧缺失：站内已镜像的 fsid 本次未出现 → 仅报告，不动站内数据
    const mirrored = await this.prisma.photo.findMany({
      where: { netdiskFsId: { not: null } },
      select: {
        id: true,
        publicId: true,
        netdiskFsId: true,
        netdiskPath: true,
        album: { select: { title: true } },
      },
    });
    const missing: NetdiskMissingPhoto[] = mirrored
      .filter((photo) => !seen.has(photo.netdiskFsId ?? ""))
      .map((photo) => ({
        photoId: photo.id,
        publicId: photo.publicId,
        filename: photo.netdiskPath?.split("/").pop() ?? photo.publicId,
        albumTitle: photo.album.title,
      }));

    await this.sync.saveScanReport({
      status: "DONE",
      scannedAt: new Date().toISOString(),
      albumsCreated,
      importedCount,
      missing,
      error: null,
    });
    this.logger.log(
      `网盘扫描完成：导入 ${importedCount} 张，新建专辑 ${albumsCreated.length} 个，缺失 ${missing.length} 张`,
    );
  }

  /** 递归遍历目录（分页），记录全部 fsid 与未镜像的图片文件。 */
  private async walk(
    dir: string,
    seen: Set<string>,
    knownFsIds: Set<string>,
    newFiles: { fsId: number; filename: string; dirName: string }[],
  ): Promise<void> {
    for (let page = 1; ; page++) {
      const response = await this.credentials.withAccessToken((token) =>
        this.baiduApi.list(token, dir, page),
      );
      for (const entry of response.list ?? []) {
        seen.add(String(entry.fs_id));
        if (entry.isdir === 1) {
          await this.walk(entry.path, seen, knownFsIds, newFiles);
        } else if (
          isImportableImage(entry.server_filename, entry.category) &&
          !knownFsIds.has(String(entry.fs_id))
        ) {
          newFiles.push({
            fsId: entry.fs_id,
            filename: entry.server_filename,
            dirName: entry.path.split("/").slice(-2, -1)[0] ?? "",
          });
        }
      }
      if ((response.list ?? []).length < 100) {
        break;
      }
    }
  }

  // ---- 改名/移动传播 ----

  private async runMove(data: {
    photoId: string;
    destAlbumTitle: string;
  }): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: data.photoId },
      select: { netdiskPath: true },
    });
    if (!photo?.netdiskPath) {
      return;
    }
    const appDir = await this.sync.resolveAppDir();
    const destDir = `${appDir}/${sanitizeNetdiskName(data.destAlbumTitle)}`;
    const filename = photo.netdiskPath.split("/").pop() ?? "";
    await this.credentials.withAccessToken((token) =>
      this.baiduApi.filemanager(token, "move", [
        { path: photo.netdiskPath ?? "", dest: destDir, newname: filename },
      ]),
    );
    await this.prisma.photo.update({
      where: { id: data.photoId },
      data: { netdiskPath: `${destDir}/${filename}` },
    });
  }

  private async runRenameAlbum(data: {
    albumId: string;
    oldTitle: string;
    newTitle: string;
  }): Promise<void> {
    const oldName = sanitizeNetdiskName(data.oldTitle);
    const newName = sanitizeNetdiskName(data.newTitle);
    if (oldName === newName) {
      return;
    }
    const appDir = await this.sync.resolveAppDir();
    const oldDir = `${appDir}/${oldName}`;
    const newDir = `${appDir}/${newName}`;
    try {
      await this.credentials.withAccessToken((token) =>
        this.baiduApi.filemanager(token, "rename", [
          { path: oldDir, newname: newName },
        ]),
      );
    } catch (error) {
      // 目录不存在 = 该专辑从未推送过，视为成功跳过
      if (!(error instanceof BaiduApiError && error.errno === -9)) {
        throw error;
      }
      this.logger.log(`网盘目录不存在，跳过重命名：${oldDir}`);
      return;
    }
    // 同步修正该专辑照片记录的镜像路径前缀
    const photos = await this.prisma.photo.findMany({
      where: {
        albumId: data.albumId,
        netdiskPath: { startsWith: `${oldDir}/` },
      },
      select: { id: true, netdiskPath: true },
    });
    for (const photo of photos) {
      await this.prisma.photo.update({
        where: { id: photo.id },
        data: {
          netdiskPath: photo.netdiskPath?.replace(`${oldDir}/`, `${newDir}/`),
        },
      });
    }
  }
}
