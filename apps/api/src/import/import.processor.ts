import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConflictException, Logger } from "@nestjs/common";
import type { ImportItemStatus } from "@photo/shared";
import type { Job } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiService } from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
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
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly baiduApi: BaiduApiService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly credentials: BaiduCredentialService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly photoService: PhotoService,
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

    // 上次运行中断（进程被杀/Redis 重启）的条目重置后继续
    await this.prisma.importItem.updateMany({
      where: { jobId: dbJob.id, status: { in: IN_FLIGHT_STATUSES } },
      data: { status: "PENDING", error: null },
    });
    await this.prisma.importJob.update({
      where: { id: dbJob.id },
      data: { status: "RUNNING", error: null },
    });

    for (const item of dbJob.items.filter(
      (entry) => entry.status === "PENDING",
    )) {
      await this.processItem(
        dbJob.id,
        dbJob.albumId,
        item.id,
        Number(item.sourceFileId),
      );
    }

    await this.finalize(dbJob.id);
  }

  private async processItem(
    jobId: string,
    albumId: string,
    itemId: string,
    fsId: number,
  ): Promise<void> {
    try {
      await this.prisma.importItem.update({
        where: { id: itemId },
        data: { status: "DOWNLOADING", error: null },
      });

      // dlink 有时效：每条目下载前现取，绝不持久化
      const accessToken = await this.credentials.getValidAccessToken();
      const metas = await this.baiduApi.filemetas(accessToken, [fsId]);
      const dlink = metas[0]?.dlink;
      if (!dlink) {
        throw new Error("未获取到下载地址");
      }
      const buffer = await this.baiduApi.download(dlink, accessToken);

      await this.prisma.importItem.update({
        where: { id: itemId },
        data: { status: "PROCESSING" },
      });
      const photo = await this.photoService.createPhotoFromBuffer(
        albumId,
        buffer,
      );

      await this.prisma.importItem.update({
        where: { id: itemId },
        data: { status: "SUCCEEDED", photoId: photo.id },
      });
    } catch (error) {
      const skipped = error instanceof ConflictException;
      const message =
        error instanceof Error ? error.message : "未知错误（导入失败）";
      await this.prisma.importItem.update({
        where: { id: itemId },
        data: {
          status: skipped ? "SKIPPED" : "FAILED",
          error: skipped ? "相同内容的照片已存在，自动跳过" : message,
        },
      });
      if (!skipped) {
        this.logger.warn(`导入条目失败（${itemId}）: ${message}`);
      }
    } finally {
      await this.refreshJobCounters(jobId);
    }
  }

  /** 条目计数实时写回 job，进度横幅轮询 DB 即可。 */
  private async refreshJobCounters(jobId: string): Promise<void> {
    const counts = await this.prisma.importItem.groupBy({
      by: ["status"],
      where: { jobId },
      _count: { status: true },
    });
    const byStatus = (status: string) =>
      counts.find((entry) => entry.status === status)?._count.status ?? 0;
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        completed: byStatus("SUCCEEDED"),
        failed: byStatus("FAILED"),
        skipped: byStatus("SKIPPED"),
      },
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
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status },
    });
  }
}
