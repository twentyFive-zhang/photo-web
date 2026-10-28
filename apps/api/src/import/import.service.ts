import { InjectQueue } from "@nestjs/bullmq";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateBaiduImportInput,
  ImportItem,
  ImportJob,
} from "@photo/shared";
import type {
  ImportItem as DbImportItem,
  ImportJob as DbImportJob,
} from "@prisma/client";
import type { Queue } from "bullmq";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiService } from "../baidu/baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "../baidu/baidu-credential.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

/** 单个导入任务最多 500 张，防失控展开与超长任务（网盘自动导入分批同用此上限）。 */
export const MAX_ITEMS_PER_JOB = 500;

/** 只导入图片：扩展名白名单兜底（category===3 为主判据）。 */
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

const BULL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: true,
};

export function isImportableImage(
  filename: string,
  category: number | null,
): boolean {
  if (category === 3) {
    return true;
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function toImportItem(item: DbImportItem): ImportItem {
  return {
    id: item.id,
    jobId: item.jobId,
    sourceFileId: item.sourceFileId,
    filename: item.filename,
    status: item.status,
    error: item.error,
    photoId: item.photoId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toImportJob(
  job: DbImportJob & { items: DbImportItem[] },
): ImportJob {
  return {
    id: job.id,
    source: job.source,
    status: job.status,
    albumId: job.albumId,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    error: job.error,
    items: job.items.map(toImportItem),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly baiduApi: BaiduApiService,
    // biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
    private readonly credentials: BaiduCredentialService,
    @InjectQueue("import") private readonly queue: Queue,
  ) {}

  /**
   * 创建导入任务：所选条目中文件夹在此同步递归展开（图片过滤、500 上限），
   * 用户确认的总数即精确值。展开用 list 分页，每个 fsid 只入队一次。
   */
  async createBaiduImport(input: CreateBaiduImportInput): Promise<ImportJob> {
    const album = await this.prisma.album.findUnique({
      where: { id: input.albumId },
      select: { id: true },
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }
    if (!(await this.credentials.isConnected())) {
      throw new BadRequestException("尚未连接百度网盘");
    }

    const files = new Map<number, { fsId: number; filename: string }>();
    for (const entry of input.entries) {
      if (entry.isDir) {
        await this.expandFolder(entry.path, files);
      } else if (isImportableImage(entry.serverFilename, null)) {
        files.set(entry.fsId, {
          fsId: entry.fsId,
          filename: entry.serverFilename,
        });
      }
    }
    if (files.size === 0) {
      throw new BadRequestException("所选内容中没有可导入的图片");
    }
    if (files.size > MAX_ITEMS_PER_JOB) {
      throw new BadRequestException(
        `所选内容超过 ${MAX_ITEMS_PER_JOB} 个文件上限，请分批导入`,
      );
    }

    const job = await this.prisma.importJob.create({
      data: {
        source: "BAIDU",
        albumId: input.albumId,
        total: files.size,
        items: {
          createMany: {
            data: [...files.values()].map((file) => ({
              // sourceFileId 用网盘 fsid；同任务内唯一
              sourceFileId: String(file.fsId),
              filename: file.filename,
            })),
          },
        },
      },
      include: { items: true },
    });
    await this.queue.add("import", { importJobId: job.id }, BULL_JOB_OPTIONS);
    return toImportJob(job);
  }

  async getJob(jobId: string): Promise<ImportJob> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    if (!job) {
      throw new NotFoundException("导入任务不存在");
    }
    return toImportJob(job);
  }

  /** 专辑最近的任务（进度横幅用）。 */
  async listByAlbum(albumId: string, take = 5): Promise<ImportJob[]> {
    const jobs = await this.prisma.importJob.findMany({
      where: { albumId },
      orderBy: { createdAt: "desc" },
      take,
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    return jobs.map(toImportJob);
  }

  /** 重试：FAILED 条目重置为 PENDING 后重新入队（依赖 sha256 去重保持幂等）。 */
  async retry(jobId: string): Promise<ImportJob> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });
    if (!job) {
      throw new NotFoundException("导入任务不存在");
    }
    const failedCount = job.items.filter(
      (item) => item.status === "FAILED",
    ).length;
    if (failedCount === 0) {
      throw new BadRequestException("没有可重试的失败项");
    }
    await this.prisma.importItem.updateMany({
      where: { jobId, status: "FAILED" },
      data: { status: "PENDING", error: null },
    });
    const updated = await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "QUEUED",
        error: null,
        completed: job.completed,
        failed: 0,
      },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    await this.queue.add("import", { importJobId: jobId }, BULL_JOB_OPTIONS);
    return toImportJob(updated);
  }

  /** 递归展开文件夹：只收集图片文件；超上限立即报错（不静默截断）。 */
  private async expandFolder(
    dir: string,
    files: Map<number, { fsId: number; filename: string }>,
  ): Promise<void> {
    for (let page = 1; ; page++) {
      const response = await this.credentials.withAccessToken((token) =>
        this.baiduApi.list(token, dir, page),
      );
      for (const entry of response.list ?? []) {
        if (entry.isdir === 1) {
          await this.expandFolder(entry.path, files);
        } else if (isImportableImage(entry.server_filename, entry.category)) {
          files.set(entry.fs_id, {
            fsId: entry.fs_id,
            filename: entry.server_filename,
          });
          if (files.size > MAX_ITEMS_PER_JOB) {
            throw new BadRequestException(
              `所选内容超过 ${MAX_ITEMS_PER_JOB} 个文件上限，请分批导入`,
            );
          }
        }
      }
      if ((response.list ?? []).length < 100) {
        break;
      }
    }
  }
}
