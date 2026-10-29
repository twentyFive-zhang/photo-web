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
  UseGuards,
} from "@nestjs/common";
import type { NetdiskStatus } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiError, BaiduApiService } from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
import { AdminGuard } from "../common/admin.guard.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { NetdiskSyncService } from "./netdisk-sync.service.js";

/** 百度网盘镜像同步：状态、手动扫描、全量推送、待确认删除。 */
@Controller("admin/netdisk")
@UseGuards(AdminGuard)
export class NetdiskController {
  constructor(
    private readonly prisma: PrismaService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly baiduApi: BaiduApiService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly credentials: BaiduCredentialService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly sync: NetdiskSyncService,
  ) {}

  @Get("status")
  async status(): Promise<NetdiskStatus> {
    const [connection, setting, totalPhotos, syncedCount, pendingDeletes] =
      await Promise.all([
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
      scanReport: await this.sync.readScanReport(),
    };
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
}
