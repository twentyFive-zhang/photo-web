import { createHash } from "node:crypto";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConflictException, Logger } from "@nestjs/common";
import type { ImportItemStatus } from "@photo/shared";
import type { Job } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AlbumService } from "../album/album.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduDownloadService } from "../baidu/baidu-download.service.js";
import {
  isForeignKeyViolation,
  isMissingRecordError,
} from "../common/prisma-errors.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PhotoService } from "../photo/photo.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

interface ImportJobPayload {
  importJobId: string;
}

/** 中断恢复时把卡在中间态的条目重置回 PENDING。 */
const IN_FLIGHT_STATUSES: ImportItemStatus[] = ["DOWNLOADING", "PROCESSING"];

@Processor("import", { concurrency: 2 })
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baiduDownload: BaiduDownloadService,
    private readonly photoService: PhotoService,
    private readonly albumService: AlbumService,
  ) {
    super();
  }

  /** 逐条处理：filemetas 取 dlink → 下载 → 照片核心；单条失败不拖垮任务。 */
  async process(job: Job<ImportJobPayload>): Promise<void> {
    const dbJob = await this.prisma.importJob.findUnique({
      where: { id: job.data.importJobId },
      include: { items: true },
    });
    if (!dbJob) {
      this.logger.warn(`导入任务不存在，跳过（${job.data.importJobId}）`);
      return;
    }

    // 上次运行中断（进程被杀/Redis 重启）的条目重置后继续。
    await this.prisma.importItem.updateMany({
      where: { jobId: dbJob.id, status: { in: IN_FLIGHT_STATUSES } },
      data: { status: "PENDING", error: null },
    });
    const resumed = await this.prisma.importJob
      .update({
        where: { id: dbJob.id },
        data: { status: "RUNNING", error: null },
      })
      .catch((error: unknown) => {
        if (!isMissingRecordError(error)) {
          throw error;
        }
        return null;
      });
    if (resumed === null) {
      this.logger.warn(`导入任务已被删除，跳过（${job.data.importJobId}）`);
      return;
    }

    for (const item of dbJob.items.filter(
      (entry) => entry.status === "PENDING",
    )) {
      await this.processItem(
        dbJob.id,
        item.id,
        Number(item.sourceFileId),
        dbJob.albumId,
      );
    }

    await this.finalize(dbJob.id);
  }

  private async processItem(
    jobId: string,
    itemId: string,
    fsId: number,
    albumId: string | null,
  ): Promise<void> {
    // buffer 提到 try 外：catch 内的去重命中分支要按内容找已有照片
    let buffer: Buffer | undefined;
    try {
      await this.prisma.importItem.update({
        where: { id: itemId },
        data: { status: "DOWNLOADING", error: null },
      });

      // dlink 有时效：每条目下载前现取，绝不持久化
      const downloaded = await this.baiduDownload.downloadByFsId(fsId);
      buffer = downloaded.buffer;
      const { path } = downloaded;

      await this.prisma.importItem.update({
        where: { id: itemId },
        data: { status: "PROCESSING" },
      });
      // 网盘导入（ADR 0005/0006）：原件本就在网盘——拉一次 buffer 只生成变体，
      // 不落本地原件、不入 staging、不触发推送；直接回写 fsid 索引与路径缓存。
      // ADR 0007：任务附带 albumId 时，成功后由 attachToAlbum 自动纳入专辑。
      const photo = await this.photoService.createPhotoFromBuffer(buffer);
      await this.prisma.photo.update({
        where: { id: photo.id },
        data: {
          netdiskFsId: String(fsId),
          netdiskPath: path,
        },
      });
      await this.attachToAlbum(albumId, photo.id);

      await this.prisma.importItem.update({
        where: { id: itemId },
        data: { status: "SUCCEEDED", photoId: photo.id },
      });
    } catch (error) {
      // 任务在导入进行中被删（级联清理）：照片行也建不进去（P2003 外键）
      // ——下载产物不入库，记日志跳过，不再回写状态、不让任务报错重试
      if (isMissingRecordError(error) || isForeignKeyViolation(error)) {
        this.logger.warn(
          `导入条目中止（任务已被删除，级联清理）：fsId=${fsId}`,
        );
        return;
      }
      // sha256 去重命中（ADR 0007）：附带专辑时把已存在的旧照片纳入该专辑，
      // 条目按成功计（照片本就存在 + 已纳入，本次导入目标已达成）；
      // 未附带专辑时维持原 SKIPPED 语义。去重命中不回写 fsid——旧照片可能
      // 已有别的网盘映射或本地暂存原件，这里只管纳入。
      if (error instanceof ConflictException && albumId && buffer) {
        const duplicate = await this.findDuplicatePhoto(buffer);
        if (duplicate) {
          await this.attachToAlbum(albumId, duplicate.id);
          await this.prisma.importItem
            .update({
              where: { id: itemId },
              data: { status: "SUCCEEDED", photoId: duplicate.id },
            })
            .catch((updateError: unknown) => {
              if (!isMissingRecordError(updateError)) {
                throw updateError;
              }
              this.logger.warn(`导入条目已被删除，跳过状态回写（${itemId}）`);
            });
          this.logger.log(
            `导入条目 sha256 去重命中，已有照片纳入专辑：fsId=${fsId} photoId=${duplicate.id}`,
          );
          return;
        }
      }
      const skipped = error instanceof ConflictException;
      const message =
        error instanceof Error ? error.message : "未知错误（导入失败）";
      await this.prisma.importItem
        .update({
          where: { id: itemId },
          data: {
            status: skipped ? "SKIPPED" : "FAILED",
            error: skipped ? "相同内容的照片已存在，自动跳过" : message,
          },
        })
        .catch((updateError: unknown) => {
          // 条目恰在此间被级联删：状态无处可写，记日志跳过
          if (!isMissingRecordError(updateError)) {
            throw updateError;
          }
          this.logger.warn(`导入条目已被删除，跳过状态回写（${itemId}）`);
        });
      if (!skipped) {
        this.logger.warn(`导入条目失败（${itemId}）: ${message}`);
      }
    } finally {
      await this.refreshJobCounters(jobId);
    }
  }

  /** 条目计数实时写回 job，进度横幅轮询 DB 即可；任务被级联删时静默跳过。 */
  private async refreshJobCounters(jobId: string): Promise<void> {
    const counts = await this.prisma.importItem.groupBy({
      by: ["status"],
      where: { jobId },
      _count: { status: true },
    });
    const byStatus = (status: string) =>
      counts.find((entry) => entry.status === status)?._count.status ?? 0;
    await this.prisma.importJob
      .update({
        where: { id: jobId },
        data: {
          completed: byStatus("SUCCEEDED"),
          failed: byStatus("FAILED"),
          skipped: byStatus("SKIPPED"),
        },
      })
      .catch((error: unknown) => {
        if (!isMissingRecordError(error)) {
          throw error;
        }
        this.logger.warn(`导入任务已被删除，跳过计数回写（${jobId}）`);
      });
  }

  /** 按条目派生终态：全成 SUCCEEDED / 全败 FAILED / 混合 PARTIAL。 */
  private async finalize(jobId: string): Promise<void> {
    const counts = await this.prisma.importItem.groupBy({
      by: ["status"],
      where: { jobId },
      _count: { status: true },
    });
    const byStatus = (status: string) =>
      counts.find((entry) => entry.status === status)?._count.status ?? 0;
    const failed = byStatus("FAILED");
    const pending =
      byStatus("PENDING") + byStatus("DOWNLOADING") + byStatus("PROCESSING");
    const succeeded = byStatus("SUCCEEDED");
    const total = counts.reduce((sum, entry) => sum + entry._count.status, 0);

    // 仍有未处理条目说明本轮只跑了部分（如重试），留待下一轮/再次重试
    if (pending > 0 && succeeded + failed + byStatus("SKIPPED") > 0) {
      return;
    }
    const status =
      failed === 0 ? "SUCCEEDED" : failed === total ? "FAILED" : "PARTIAL";
    await this.prisma.importJob
      .update({
        where: { id: jobId },
        data: { status },
      })
      .catch((error: unknown) => {
        if (!isMissingRecordError(error)) {
          throw error;
        }
        this.logger.warn(`导入任务已被删除，跳过终态回写（${jobId}）`);
      });
  }

  /**
   * 把照片纳入任务附带的目标专辑（ADR 0007 一步挂专辑；复用 AlbumService
   * 的锁行 + max+1 追加逻辑）。专辑中途被删或成员写入失败时降级为仅入库
   * （照片保留、无成员行、任务不判失败），只记 warning。未附带专辑时空操作。
   */
  private async attachToAlbum(
    albumId: string | null,
    photoId: string,
  ): Promise<void> {
    if (!albumId) {
      return;
    }
    try {
      await this.albumService.addPhotos(albumId, { photoIds: [photoId] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `导入附带专辑失败，条目降级为仅入库：albumId=${albumId} photoId=${photoId} ${message}`,
      );
    }
  }

  /** 按内容 sha256 找已存在的照片（去重命中时纳入旧照片用）。 */
  private async findDuplicatePhoto(
    buffer: Buffer,
  ): Promise<{ id: string } | null> {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    return this.prisma.photo.findUnique({
      where: { sha256 },
      select: { id: true },
    });
  }
}
