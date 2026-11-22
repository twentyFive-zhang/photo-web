import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  Photo,
  PublicRendition,
  SetPhotoTagsInput,
  UpdatePhotoInput,
} from "@photo/shared";
import { normalizeTagNames } from "@photo/shared";
import { Prisma } from "@prisma/client";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduDownloadService } from "../baidu/baidu-download.service.js";
import { generatePublicId } from "../common/id.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { NetdiskSyncService } from "../netdisk/netdisk-sync.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { StorageService } from "../storage/storage.service.js";
import type { GeneratedRendition } from "./photo-processing.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PhotoProcessingService } from "./photo-processing.service.js";

const photoInclude = {
  album: { select: { id: true, publicId: true, title: true } },
  renditions: true,
  tags: { include: { tag: true } },
} satisfies Prisma.PhotoInclude;

type PhotoWithRelations = Prisma.PhotoGetPayload<{
  include: typeof photoInclude;
}>;

const isUniqueViolation = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

function toPhoto(photo: PhotoWithRelations): Photo {
  return {
    id: photo.id,
    publicId: photo.publicId,
    albumId: photo.albumId,
    album: photo.album,
    title: photo.title,
    caption: photo.caption,
    originalKey: photo.originalKey,
    sha256: photo.sha256,
    width: photo.width,
    height: photo.height,
    exif: (photo.exif as Photo["exif"]) ?? null,
    sortOrder: photo.sortOrder,
    tags: photo.tags.map(({ tag }) => ({ id: tag.id, name: tag.name })),
    createdAt: photo.createdAt.toISOString(),
    updatedAt: photo.updatedAt.toISOString(),
  };
}

function toRenditionRecord(rendition: GeneratedRendition, key: string) {
  return {
    variant: rendition.variant,
    format: "WEBP" as const,
    key,
    width: rendition.width,
    height: rendition.height,
    bytes: rendition.bytes,
  };
}

@Injectable()
export class PhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly processing: PhotoProcessingService,
    private readonly netdisk: NetdiskSyncService,
    private readonly baiduDownload: BaiduDownloadService,
  ) {}

  /** 本地上传：变体 + 暂存原件落存储，元数据/EXIF 落库；入队网盘上行推送。 */
  async upload(albumId: string, file: Express.Multer.File): Promise<Photo> {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true },
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }

    this.processing.assertUploadable(file.mimetype, file.size);
    const photo = await this.createPhotoFromBuffer(albumId, file.buffer, {
      stageOriginal: true,
    });
    await this.netdisk.enqueuePush(photo.id);
    return photo;
  }

  /**
   * 照片创建核心（本地上传与网盘导入共用）：
   * sha256 去重（重复抛 ConflictException）→ 两档 WebP + EXIF → 落存储 → 事务落库。
   * 调用方需先完成专辑存在性检查与格式校验。
   *
   * ADR 0005 存储模型：母版唯一权威在网盘源文件库。
   * - stageOriginal=true（本地上传）：原件临时落本地（staging），推送成功后
   *   由 push 流程删除；推送成功前任何时刻照片都有母本。
   * - stageOriginal=false（网盘导入）：原件本就在网盘，不落本地、不入
   *   staging、不触发推送（originalKey 仅保留扩展名推导用途）。
   */
  async createPhotoFromBuffer(
    albumId: string,
    buffer: Buffer,
    options: { stageOriginal?: boolean } = {},
  ): Promise<Photo> {
    await this.processing.assertBufferSupported(buffer);

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicate = await this.prisma.photo.findUnique({
      where: { sha256 },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException("相同内容的照片已存在");
    }

    const original = await this.processing.readOriginal(buffer);
    const renditions = await this.processing.generateRenditions(buffer);
    const exif = await this.processing.extractExif(buffer);

    for (let attempt = 0; attempt < 3; attempt++) {
      const publicId = generatePublicId();
      const originalKey = `photos/${publicId}/original.${original.ext}`;
      const renditionFiles = renditions.map((rendition) => ({
        key: `photos/${publicId}/${rendition.variant.toLowerCase()}.webp`,
        rendition,
      }));

      try {
        if (options.stageOriginal) {
          await this.storage.put(originalKey, buffer);
        }
        await Promise.all(
          renditionFiles.map(({ key, rendition }) =>
            this.storage.put(key, rendition.buffer),
          ),
        );

        const created = await this.prisma.$transaction(async (tx) => {
          const maxSortOrder = await tx.photo.aggregate({
            where: { albumId },
            _max: { sortOrder: true },
          });
          return tx.photo.create({
            data: {
              publicId,
              albumId,
              originalKey,
              sha256,
              width: original.width,
              height: original.height,
              // PhotoExif 无索引签名，Prisma Json 输入需要显式收窄
              exif: exif
                ? (exif as unknown as Prisma.InputJsonObject)
                : undefined,
              sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
              renditions: {
                createMany: {
                  data: renditionFiles.map(({ key, rendition }) =>
                    toRenditionRecord(rendition, key),
                  ),
                },
              },
            },
          });
        });
        // 事务返回类型不带 include，重新查询补齐关联
        return this.get(created.id);
      } catch (error) {
        // 清理已写入的文件后重试（publicId 撞唯一约束；导入未落原件时该键本就不存在）
        await this.storage.deleteMany([
          originalKey,
          ...renditionFiles.map(({ key }) => key),
        ]);
        if (!isUniqueViolation(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error("unreachable");
  }

  /**
   * 从网盘重建展示变体（ADR 0005 容灾，单张起步）：
   * 母版权威在网盘——dlink 下载原件，sha256 校验一致后重新生成
   * thumb/display 覆盖本地变体。本地变体丢失/损坏时用。
   */
  async rebuildRenditions(id: string): Promise<Photo> {
    const photo = await this.prisma.photo.findUnique({
      where: { id },
      select: { id: true, publicId: true, sha256: true, netdiskFsId: true },
    });
    if (!photo) {
      throw new NotFoundException("照片不存在");
    }
    if (!photo.netdiskFsId) {
      throw new BadRequestException("该照片尚未推送到网盘，没有可用的网盘母本");
    }

    const { buffer } = await this.baiduDownload.downloadByFsId(
      Number(photo.netdiskFsId),
    );
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== photo.sha256) {
      throw new ConflictException(
        "网盘文件内容与站内记录不一致（sha256 校验失败），请人工核对后再试",
      );
    }

    const renditions = await this.processing.generateRenditions(buffer);
    const renditionFiles = renditions.map((rendition) => ({
      key: `photos/${photo.publicId}/${rendition.variant.toLowerCase()}.webp`,
      rendition,
    }));
    for (const { key, rendition } of renditionFiles) {
      await this.storage.put(key, rendition.buffer);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.photoRendition.deleteMany({ where: { photoId: id } });
      await tx.photoRendition.createMany({
        data: renditionFiles.map(({ key, rendition }) => ({
          photoId: id,
          ...toRenditionRecord(rendition, key),
        })),
      });
    });
    return this.get(id);
  }

  async get(id: string): Promise<Photo> {
    const photo = await this.prisma.photo.findUnique({
      where: { id },
      include: photoInclude,
    });
    if (!photo) {
      throw new NotFoundException("照片不存在");
    }
    return toPhoto(photo);
  }

  async update(id: string, input: UpdatePhotoInput): Promise<Photo> {
    const photo = await this.prisma.photo
      .update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.caption !== undefined ? { caption: input.caption } : {}),
        },
        include: photoInclude,
      })
      .catch(() => {
        throw new NotFoundException("照片不存在");
      });
    return toPhoto(photo);
  }

  async remove(id: string): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id },
      select: {
        originalKey: true,
        renditions: { select: { key: true } },
        netdiskFsId: true,
        netdiskPath: true,
      },
    });
    if (!photo) {
      throw new NotFoundException("照片不存在");
    }
    // 已镜像照片：网盘文件不删，先登记托管归档再删行（登记失败即报错，
    // 照片未动可重试；JIANGLIUER-102，站内删除不碰网盘）
    if (photo.netdiskFsId && photo.netdiskPath) {
      await this.netdisk.addManagedEntry({
        fsId: photo.netdiskFsId,
        path: photo.netdiskPath,
      });
    }
    await this.prisma.photo.delete({ where: { id } });
    await this.storage.deleteMany([
      photo.originalKey,
      ...photo.renditions.map((rendition) => rendition.key),
    ]);
  }

  /** 批量移动 = 换专辑（一张照片只属于一个专辑）；已镜像照片跟随网盘移动。 */
  async batchMove(photoIds: string[], targetAlbumId: string): Promise<number> {
    const album = await this.prisma.album.findUnique({
      where: { id: targetAlbumId },
      select: { id: true, title: true },
    });
    if (!album) {
      throw new NotFoundException("目标专辑不存在");
    }

    const result = await this.prisma.photo.updateMany({
      where: { id: { in: photoIds } },
      data: { albumId: targetAlbumId },
    });
    const mirrored = await this.prisma.photo.findMany({
      where: { id: { in: photoIds }, netdiskFsId: { not: null } },
      select: { id: true },
    });
    await this.netdisk.enqueueMoves(
      mirrored.map((photo) => ({
        photoId: photo.id,
        destAlbumTitle: album.title,
      })),
    );
    return result.count;
  }

  async batchDelete(photoIds: string[]): Promise<number> {
    const photos = await this.prisma.photo.findMany({
      where: { id: { in: photoIds } },
      select: {
        originalKey: true,
        renditions: { select: { key: true } },
        netdiskFsId: true,
        netdiskPath: true,
      },
    });
    // 已镜像照片：网盘文件不删，先登记托管归档再删行（登记失败即报错，
    // 照片未动可重试；JIANGLIUER-102，站内删除不碰网盘）
    const mirrored = photos.filter(
      (photo) => photo.netdiskFsId && photo.netdiskPath,
    );
    for (const photo of mirrored) {
      await this.netdisk.addManagedEntry({
        fsId: photo.netdiskFsId ?? "",
        path: photo.netdiskPath ?? "",
      });
    }
    const result = await this.prisma.photo.deleteMany({
      where: { id: { in: photoIds } },
    });
    await this.storage.deleteMany(
      photos.flatMap((photo) => [
        photo.originalKey,
        ...photo.renditions.map((rendition) => rendition.key),
      ]),
    );
    return result.count;
  }

  /** 全量替换照片标签；name 写入前规范化（trim/空白合并/小写去重）。 */
  async setTags(photoId: string, input: SetPhotoTagsInput): Promise<Photo> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: { id: true },
    });
    if (!photo) {
      throw new NotFoundException("照片不存在");
    }

    const names = normalizeTagNames(input.names);

    await this.prisma.$transaction(async (tx) => {
      const tags = await Promise.all(
        names.map((name) =>
          tx.tag.upsert({ where: { name }, update: {}, create: { name } }),
        ),
      );

      await tx.photoTag.deleteMany({
        where: { photoId, tagId: { notIn: tags.map((tag) => tag.id) } },
      });

      await Promise.all(
        tags.map((tag) =>
          tx.photoTag.upsert({
            where: { photoId_tagId: { photoId, tagId: tag.id } },
            update: {},
            create: { photoId, tagId: tag.id },
          }),
        ),
      );
    });

    return this.get(photoId);
  }
}

/** 导出给公开视图使用：rendition key → 完整 URL。 */
export function toPublicRendition(
  rendition: {
    variant: string;
    format: string;
    width: number;
    height: number;
    bytes: number;
    key: string;
  },
  publicUrl: (key: string) => string,
): PublicRendition {
  return {
    variant: rendition.variant as PublicRendition["variant"],
    format: rendition.format as PublicRendition["format"],
    width: rendition.width,
    height: rendition.height,
    bytes: rendition.bytes,
    url: publicUrl(rendition.key),
  };
}
