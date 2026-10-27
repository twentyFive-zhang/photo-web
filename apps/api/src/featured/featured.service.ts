import { Injectable, NotFoundException } from "@nestjs/common";
import type { FeaturedItem, SetFeaturedInput } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class FeaturedService {
  constructor(private readonly prisma: PrismaService) {}

  /** 精选列表，按人工排序。 */
  async list(): Promise<FeaturedItem[]> {
    const items = await this.prisma.featuredPhoto.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        photo: { select: { id: true, publicId: true, title: true } },
      },
    });
    return items.map((item) => ({
      photoId: item.photoId,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt.toISOString(),
      photo: item.photo,
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
}
