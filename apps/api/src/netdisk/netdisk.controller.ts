import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  NetdiskCreateFolderInput,
  NetdiskCreateFolderResult,
  NetdiskDeleteInput,
  NetdiskDeleteResult,
  NetdiskRepushInput,
  NetdiskRepushResult,
  NetdiskStatus,
  NetdiskUploadAccepted,
  NetdiskUploadTasks,
} from "@photo/shared";
import {
  netdiskCreateFolderInputSchema,
  netdiskDeleteInputSchema,
  netdiskRepushInputSchema,
  sanitizeNetdiskName,
} from "@photo/shared";
import { diskStorage } from "multer";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiError, BaiduApiService } from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
import {
  assertManagedPath,
  baiduRootOf,
  normalizeManagedDir,
} from "../baidu/baidu-paths.js";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { Env } from "../config/env.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { NetdiskSyncService } from "./netdisk-sync.service.js";

/** 单文件上限 2GB（超限 multer LIMIT_FILE_SIZE → Nest 413 PayloadTooLarge）。 */
const MAX_NETDISK_UPLOAD_SIZE = 2 * 1024 ** 3;

/**
 * 上传临时落盘目录（os.tmpdir 下）： multer 先把文件写到这里，
 * 入队后由 worker 分片推百度，成功即删。系统清理 /tmp 时残留任务会
 * 以「临时文件已不存在」失败，重新上传即可。
 */
const UPLOAD_TEMP_DIR = resolve(tmpdir(), "photo-netdisk-uploads");

// multer 2.x 对字符串 destination 自带 recursive mkdir
const uploadStorage = diskStorage({
  destination: UPLOAD_TEMP_DIR,
  // 落盘文件名随机化（originalname 只作元数据），杜绝路径注入
  filename: (_req, _file, callback) => {
    callback(null, `${randomUUID()}.part`);
  },
});

/** 百度网盘镜像同步：状态、手动扫描、全量推送、待确认删除、直接管理。 */
@Controller("admin/netdisk")
@UseGuards(AdminGuard)
export class NetdiskController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly baiduApi: BaiduApiService,
    private readonly credentials: BaiduCredentialService,
    private readonly sync: NetdiskSyncService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** 写操作根：与浏览同一边界（配置 BAIDU_APP_NAME 时锁定应用目录）。 */
  private get writeRoot(): string {
    return baiduRootOf(this.config.get("BAIDU_APP_NAME", { infer: true }));
  }

  @Get("status")
  async status(): Promise<NetdiskStatus> {
    const [
      connection,
      setting,
      totalPhotos,
      syncedCount,
      pendingDeletes,
      pushFailures,
    ] = await Promise.all([
      this.credentials.getStatus(),
      this.prisma.siteSetting.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      }),
      this.prisma.photo.count(),
      this.prisma.photo.count({ where: { netdiskFsId: { not: null } } }),
      this.prisma.netdiskPendingDelete.findMany({
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.netdiskPushFailure.findMany({
        orderBy: { attemptedAt: "desc" },
      }),
    ]);

    return {
      appConfigured: connection.appConfigured,
      connected: connection.connected,
      dailyScan: setting.netdiskDailyScan,
      syncedCount,
      totalPhotos,
      pendingDeletes: pendingDeletes.map((row) => ({
        id: row.id,
        filename: row.filename,
        albumTitle: row.albumTitle,
        createdAt: row.createdAt.toISOString(),
      })),
      pushFailures: pushFailures.map((row) => ({
        id: row.id,
        photoId: row.photoId,
        publicId: row.publicId,
        filename: row.filename,
        albumTitle: row.albumTitle,
        errno: row.errno,
        error: row.error,
        attemptedAt: row.attemptedAt.toISOString(),
      })),
      scanReport: await this.sync.readScanReport(),
    };
  }

  /** 站内已导入照片的网盘 fsid 集合（浏览页做「已导入/未导入」对照）。 */
  @Get("synced-fsids")
  async syncedFsids(): Promise<{ fsids: string[] }> {
    const photos = await this.prisma.photo.findMany({
      where: { netdiskFsId: { not: null } },
      select: { netdiskFsId: true },
    });
    return { fsids: photos.map((photo) => photo.netdiskFsId ?? "") };
  }

  @Post("scan")
  @HttpCode(HttpStatus.OK)
  async scan(): Promise<{ queued: boolean }> {
    if (!(await this.credentials.isConnected())) {
      throw new BadRequestException("尚未连接百度网盘");
    }
    const result = await this.sync.enqueueScan();
    if (!result) {
      throw new ConflictException("扫描正在进行中");
    }
    return result;
  }

  @Post("push-all")
  @HttpCode(HttpStatus.OK)
  async pushAll(): Promise<{ queued: number }> {
    if (!(await this.credentials.isConnected())) {
      throw new BadRequestException("尚未连接百度网盘");
    }
    const state = await this.sync.enqueuePushAll();
    if (!state) {
      throw new ConflictException("全量推送正在进行中");
    }
    return { queued: state.queued };
  }

  /** 按专辑补推：该专辑未同步照片入队（连接网盘前上传或推送失败的存量）。 */
  @Post("albums/:albumId/push")
  @HttpCode(HttpStatus.OK)
  async pushAlbum(
    @Param("albumId") albumId: string,
  ): Promise<{ queued: number }> {
    if (!(await this.credentials.isConnected())) {
      throw new BadRequestException("尚未连接百度网盘");
    }
    return { queued: await this.sync.enqueuePushAlbum(albumId) };
  }

  /**
   * 缺失/推送失败一键重推：清旧映射后复用既有 push 管线（幂等，jobId 去重）。
   * body.photoIds 来自扫描报告 missing 列表或推送失败列表。
   */
  @Post("missing/repush")
  @HttpCode(HttpStatus.OK)
  async repushMissing(
    @Body(new ZodValidationPipe(netdiskRepushInputSchema))
    body: NetdiskRepushInput,
  ): Promise<NetdiskRepushResult> {
    if (!(await this.credentials.isConnected())) {
      throw new BadRequestException("尚未连接百度网盘");
    }
    return { queued: await this.sync.enqueueRepush(body.photoIds) };
  }

  /** 忽略推送失败记录：网盘侧不处理，仅移除提示。 */
  @Post("push-failures/:id/dismiss")
  @HttpCode(HttpStatus.OK)
  async dismissPushFailure(@Param("id") id: string): Promise<void> {
    const row = await this.prisma.netdiskPushFailure.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException("推送失败记录不存在");
    }
    await this.prisma.netdiskPushFailure.delete({ where: { id } });
  }

  /** 确认删除网盘镜像文件（站内已删，这里真正删网盘侧副本）。 */
  @Post("pending-deletes/:id/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmPendingDelete(@Param("id") id: string): Promise<void> {
    const row = await this.prisma.netdiskPendingDelete.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException("待确认删除项不存在");
    }
    if (!row.path) {
      throw new BadRequestException("缺少网盘路径，无法删除，请手动处理");
    }
    try {
      await this.credentials.withAccessToken((token) =>
        this.baiduApi.filemanager(token, "delete", [{ path: row.path }]),
      );
    } catch (error) {
      // 文件已不存在 = 目标状态已达成
      if (!(error instanceof BaiduApiError && error.errno === -9)) {
        throw error;
      }
    }
    await this.prisma.netdiskPendingDelete.delete({ where: { id } });
  }

  /** 放弃删除：网盘保留副本，移除待确认记录。 */
  @Post("pending-deletes/:id/dismiss")
  @HttpCode(HttpStatus.OK)
  async dismissPendingDelete(@Param("id") id: string): Promise<void> {
    const row = await this.prisma.netdiskPendingDelete.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException("待确认删除项不存在");
    }
    await this.prisma.netdiskPendingDelete.delete({ where: { id } });
  }

  // ---------- 直接管理（新建/删除/直传，JIANGLIUER-94，ADR 0004） ----------

  /**
   * 新建文件夹：落点 = dir（当前浏览目录，空 = 应用根）。
   * 同名冲突（百度 create rtype=2 → errno -8）返回 409。
   */
  @Post("folders")
  @HttpCode(HttpStatus.OK)
  async createFolder(
    @Body(new ZodValidationPipe(netdiskCreateFolderInputSchema))
    body: NetdiskCreateFolderInput,
  ): Promise<NetdiskCreateFolderResult> {
    if (!(await this.credentials.isConnected())) {
      throw new ConflictException("尚未连接百度网盘，请先授权");
    }
    const name = sanitizeNetdiskName(body.name);
    const path = `${normalizeManagedDir(this.writeRoot, body.dir)}/${name}`;
    try {
      await this.credentials.withAccessToken((token) =>
        this.baiduApi.create(token, { path, isdir: true, rtype: 2 }),
      );
    } catch (error) {
      if (error instanceof BaiduApiError && error.errno === -8) {
        throw new ConflictException("同名文件夹已存在");
      }
      throw error;
    }
    return { path };
  }

  /**
   * 删除（单删/批删/文件夹级联共用）：百度默认删除（进回收站），
   * 镜像联动即时清映射（变回「未推送」，全量推送/按专辑补推可恢复）；
   * 托管登记同步移除。不动 NetdiskPendingDelete 表。
   */
  @Post("entries/delete")
  @HttpCode(HttpStatus.OK)
  async deleteEntries(
    @Body(new ZodValidationPipe(netdiskDeleteInputSchema))
    body: NetdiskDeleteInput,
  ): Promise<NetdiskDeleteResult> {
    if (!(await this.credentials.isConnected())) {
      throw new ConflictException("尚未连接百度网盘，请先授权");
    }
    const paths = [
      ...new Set(body.paths.map((p) => assertManagedPath(this.writeRoot, p))),
    ];
    if (paths.length === 0) {
      throw new BadRequestException("缺少要删除的路径");
    }
    try {
      await this.credentials.withAccessToken((token) =>
        this.baiduApi.filemanager(
          token,
          "delete",
          paths.map((path) => ({ path })),
        ),
      );
    } catch (error) {
      // 文件/目录已不存在 = 目标状态已达成（清理映射仍然有意义）
      if (!(error instanceof BaiduApiError && error.errno === -9)) {
        throw error;
      }
    }
    const clearedPhotos = await this.sync.clearMirrorMappings(paths);
    await this.sync.removeManagedEntriesByPaths(paths);
    return { deleted: paths.length, clearedPhotos };
  }

  /** 直接上传（任意格式托管文件）：临时落盘 → 队列分片推百度 → 页面看任务状态。 */
  @Post("files/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: uploadStorage,
      limits: { fileSize: MAX_NETDISK_UPLOAD_SIZE },
    }),
  )
  async uploadFile(
    @UploadedFile() file?: Express.Multer.File,
    @Body("dir") dir?: string,
  ): Promise<NetdiskUploadAccepted> {
    if (!file) {
      throw new BadRequestException("缺少文件字段 file");
    }
    if (file.size === 0) {
      await this.removeTempFile(file.path);
      throw new BadRequestException("不能上传空文件");
    }
    if (!(await this.credentials.isConnected())) {
      await this.removeTempFile(file.path);
      throw new ConflictException("尚未连接百度网盘，请先授权");
    }
    const filename = sanitizeNetdiskName(file.originalname);
    const destPath = `${normalizeManagedDir(this.writeRoot, dir)}/${filename}`;
    const taskId = randomUUID();
    await this.sync.enqueueManagedUpload({
      taskId,
      tempPath: file.path,
      destPath,
      filename,
      size: file.size,
    });
    return { taskId };
  }

  /** 最近托管上传任务（BullMQ 任务状态，不入库）。 */
  @Get("uploads")
  async uploads(): Promise<NetdiskUploadTasks> {
    return this.sync.listManagedUploads();
  }

  private async removeTempFile(path: string): Promise<void> {
    await unlink(path).catch(() => undefined);
  }
}
