import { Injectable, NotFoundException } from "@nestjs/common";
import type { Tag } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class TagService {
  constructor(private readonly prisma: PrismaService) {}

  /** 全部标签，按照片数降序。 */
  async list(): Promise<Tag[]> {
    const tags = await this.prisma.tag.findMany({
      orderBy: { photos: { _count: "desc" } },
      include: { _count: { select: { photos: true } } },
    });
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      photoCount: tag._count.photos,
    }));
  }

  async remove(id: string): Promise<void> {
    await this.prisma.tag.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("标签不存在");
    });
  }
}
