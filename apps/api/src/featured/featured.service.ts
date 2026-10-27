import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  FeaturedItem,
  PublicFeaturedPhoto,
  SetFeaturedInput,
} from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { StorageService } from "../storage/storage.service.js";

@Injectable()
export class FeaturedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** 精选列表，按人工排序。thumbKey 供后台缩略图。 */
  async list(): Promise<FeaturedItem[]> {
    const items = await this.prisma.featuredPhoto.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        photo: {
          select: {
            id: true,
            publicId: true,
            title: true,
            renditions: { where: { variant: "THUMB" as const } },
          },
        },
      },
    });
    return items.map((item) => ({
      photoId: item.photoId,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt.toISOString(),
      photo: {
        id: item.photo.id,
        publicId: item.photo.publicId,
        title: item.photo.title,
      },
      thumbKey: item.photo.renditions[0]?.key ?? null,
    }));
  }

  /** 全量替换精选列表；空数组 = 清空。 */
  async set(input: SetFeaturedInput): Promise<FeaturedItem[]> {
    const uniqueIds = [...new Set(input.photoIds)];
    if (uniqueIds.length !== input.photoIds.length) {
      throw new NotFoundException("photoIds 存在重复");
    }

    if (uniqueIds.length > 0) {
      const count = await this.prisma.photo.count({
        where: { id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) {
        throw new NotFoundException("存在不存在的照片");
      }
    }

    await this.prisma.$transaction([
      this.prisma.featuredPhoto.deleteMany(),
      ...uniqueIds.map((photoId, index) =>
        this.prisma.featuredPhoto.create({
          data: { photoId, sortOrder: index },
        }),
      ),
    ]);

    return this.list();
  }

  async remove(photoId: string): Promise<void> {
    await this.prisma.featuredPhoto.delete({ where: { photoId } }).catch(() => {
      throw new NotFoundException("该照片不在精选列表中");
    });
  }

  /** 公开精选：含 rendition URL 与所属专辑（用于跳转）。 */
  async listPublic(): Promise<PublicFeaturedPhoto[]> {
    const items = await this.prisma.featuredPhoto.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        photo: {
          include: {
            renditions: true,
            tags: { include: { tag: true } },
            album: { select: { publicId: true, title: true } },
          },
        },
      },
    });

    return items.map((item) => ({
      publicId: item.photo.publicId,
      title: item.photo.title,
      caption: item.photo.caption,
      width: item.photo.width,
      height: item.photo.height,
      exif: (item.photo.exif as PublicFeaturedPhoto["exif"]) ?? null,
      sortOrder: item.sortOrder,
      renditions: item.photo.renditions.map((rendition) => ({
        variant: rendition.variant,
        format: rendition.format,
        width: rendition.width,
        height: rendition.height,
        bytes: rendition.bytes,
        url: this.storage.publicUrl(rendition.key),
      })),
      tags: item.photo.tags.map(({ tag }) => ({ id: tag.id, name: tag.name })),
      album: {
        publicId: item.photo.album.publicId,
        title: item.photo.album.title,
      },
    }));
  }
}
