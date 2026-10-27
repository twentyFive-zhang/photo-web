import { Injectable, NotFoundException } from "@nestjs/common";
import type { Photo, SetPhotoTagsInput, UpdatePhotoInput } from "@photo/shared";
import { normalizeTagNames } from "@photo/shared";
import type { Prisma } from "@prisma/client";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

const photoInclude = {
  album: { select: { id: true, publicId: true, title: true } },
  renditions: true,
  tags: { include: { tag: true } },
} satisfies Prisma.PhotoInclude;

type PhotoWithRelations = Prisma.PhotoGetPayload<{
  include: typeof photoInclude;
}>;

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

@Injectable()
export class PhotoService {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.photo.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("照片不存在");
    });
    // TODO(M3): 同步删除 StorageService 中的原件与各档展示图
  }

  /** 批量移动 = 换专辑（一张照片只属于一个专辑）。 */
  async batchMove(photoIds: string[], targetAlbumId: string): Promise<number> {
    const album = await this.prisma.album.findUnique({
      where: { id: targetAlbumId },
      select: { id: true },
    });
    if (!album) {
      throw new NotFoundException("目标专辑不存在");
    }

    const result = await this.prisma.photo.updateMany({
      where: { id: { in: photoIds } },
      data: { albumId: targetAlbumId },
    });
    return result.count;
  }

  async batchDelete(photoIds: string[]): Promise<number> {
    const result = await this.prisma.photo.deleteMany({
      where: { id: { in: photoIds } },
    });
    // TODO(M3): 同步删除 StorageService 中的原件与各档展示图
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
