import { createHash } from "node:crypto";
import {
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
  ) {}

  /** 本地上传：原件 + 三档 WebP 落存储，元数据/EXIF 落库；入队网盘上行推送。 */
  async upload(albumId: string, file: Express.Multer.File): Promise<Photo> {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true },
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }

    this.processing.assertUploadable(file.mimetype, file.size);
    const photo = await this.createPhotoFromBuffer(albumId, file.buffer);
    await this.netdisk.enqueuePush(photo.id);
    return photo;
  }

  /**
   * 照片创建核心（本地上传与网盘导入共用）：
   * sha256 去重（重复抛 ConflictException）→ 三档 WebP + EXIF → 落存储 → 事务落库。
   * 调用方需先完成专辑存在性检查与格式校验。
   */
  async createPhotoFromBuffer(albumId: string, buffer: Buffer): Promise<Photo> {
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
        await this.storage.put(originalKey, buffer);
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
        // 清理已写入的文件后重试（publicId 撞唯一约束）
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
        album: { select: { title: true } },
      },
    });
    if (!photo) {
      throw new NotFoundException("照片不存在");
    }
    await this.prisma.photo.delete({ where: { id } });
    await this.storage.deleteMany([
      photo.originalKey,
      ...photo.renditions.map((rendition) => rendition.key),
    ]);
    // 已镜像的照片 → 网盘删除待人工确认（不自动传播，ADR 0002）
    if (photo.netdiskFsId) {
      await this.netdisk.markPendingDeletes([
        {
          netdiskFsId: photo.netdiskFsId,
          netdiskPath: photo.netdiskPath,
          fallbackFilename: photo.originalKey.split("/").pop() ?? id,
          albumTitle: photo.album.title,
        },
      ]);
    }
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
        album: { select: { title: true } },
      },
    });
    const result = await this.prisma.photo.deleteMany({
      where: { id: { in: photoIds } },
    });
    await this.storage.deleteMany(
      photos.flatMap((photo) => [
        photo.originalKey,
        ...photo.renditions.map((rendition) => rendition.key),
      ]),
    );
    await this.netdisk.markPendingDeletes(
      photos
        .filter((photo) => photo.netdiskFsId)
        .map((photo) => ({
          netdiskFsId: photo.netdiskFsId ?? "",
          netdiskPath: photo.netdiskPath,
          fallbackFilename: photo.originalKey.split("/").pop() ?? "",
          albumTitle: photo.album.title,
        })),
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
