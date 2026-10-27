import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  Album,
  CreateAlbumInput,
  PhotoSummary,
  ReorderPhotosInput,
  UpdateAlbumInput,
} from "@photo/shared";
import { Prisma } from "@prisma/client";
import { generatePublicId, generateShareToken } from "../common/id.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";

const isUniqueViolation = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

const albumInclude = {
  coverPhoto: {
    include: { renditions: { where: { variant: "THUMB" as const } } },
  },
  photos: {
    // 生效封面的回落来源：排序第一张照片
    take: 1,
    orderBy: { sortOrder: "asc" as const },
    select: { id: true, publicId: true, title: true },
  },
  _count: { select: { photos: true } },
} satisfies Prisma.AlbumInclude;

type AlbumWithCover = Prisma.AlbumGetPayload<{
  include: typeof albumInclude;
}>;

function toPhotoSummary(photo: {
  id: string;
  publicId: string;
  title: string | null;
}): PhotoSummary {
  return { id: photo.id, publicId: photo.publicId, title: photo.title };
}

/** 生效封面：手动 coverPhotoId 优先，否则排序第一张，空专辑为 null。 */
function resolveCover(album: AlbumWithCover): PhotoSummary | null {
  if (album.coverPhoto) {
    return toPhotoSummary(album.coverPhoto);
  }
  return album.photos[0] ? toPhotoSummary(album.photos[0]) : null;
}

function toAlbum(album: AlbumWithCover): Album {
  return {
    id: album.id,
    publicId: album.publicId,
    shareToken: album.shareToken,
    title: album.title,
    description: album.description,
    coverPhotoId: album.coverPhotoId,
    cover: resolveCover(album),
    visibility: album.visibility,
    publishedAt: album.publishedAt?.toISOString() ?? null,
    photoCount: album._count.photos,
    createdAt: album.createdAt.toISOString(),
    updatedAt: album.updatedAt.toISOString(),
  };
}

@Injectable()
export class AlbumService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Album[]> {
    const albums = await this.prisma.album.findMany({
      orderBy: { createdAt: "desc" },
      include: albumInclude,
    });
    return albums.map(toAlbum);
  }

  async get(id: string): Promise<Album> {
    const album = await this.prisma.album.findUnique({
      where: { id },
      include: albumInclude,
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }
    return toAlbum(album);
  }

  async create(input: CreateAlbumInput): Promise<Album> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const album = await this.prisma.album.create({
          data: {
            publicId: generatePublicId(),
            shareToken: generateShareToken(),
            title: input.title,
            description: input.description ?? null,
          },
          include: albumInclude,
        });
        return toAlbum(album);
      } catch (error) {
        // publicId / shareToken 撞唯一约束时换一个重试
        if (!isUniqueViolation(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error("unreachable");
  }

  async update(id: string, input: UpdateAlbumInput): Promise<Album> {
    const existing = await this.prisma.album.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("专辑不存在");
    }

    if (input.coverPhotoId) {
      const photo = await this.prisma.photo.findUnique({
        where: { id: input.coverPhotoId },
        select: { albumId: true },
      });
      if (!photo || photo.albumId !== id) {
        throw new NotFoundException("封面照片不存在或不属于该专辑");
      }
    }

    const album = await this.prisma.album.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.coverPhotoId !== undefined
          ? { coverPhotoId: input.coverPhotoId }
          : {}),
        ...(input.visibility !== undefined
          ? { visibility: input.visibility }
          : {}),
        // 首次公开时记录发布时间；之后再切换不覆盖
        ...(input.visibility === "PUBLIC" && !existing.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
      include: albumInclude,
    });
    return toAlbum(album);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.album.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("专辑不存在");
    });
  }

  /** 轮换 shareToken：旧链接立即失效。 */
  async rotateShareToken(id: string): Promise<Album> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const album = await this.prisma.album.update({
          where: { id },
          data: { shareToken: generateShareToken() },
          include: albumInclude,
        });
        return toAlbum(album);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2025") {
            throw new NotFoundException("专辑不存在");
          }
          if (error.code === "P2002" && attempt < 2) {
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error("unreachable");
  }

  async getPhotos(albumId: string) {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true },
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }

    const photos = await this.prisma.photo.findMany({
      where: { albumId },
      orderBy: { sortOrder: "asc" },
      include: {
        renditions: true,
        tags: { include: { tag: true } },
      },
    });

    return photos.map((photo) => ({
      id: photo.id,
      publicId: photo.publicId,
      title: photo.title,
      caption: photo.caption,
      sortOrder: photo.sortOrder,
      width: photo.width,
      height: photo.height,
      exif: photo.exif,
      tags: photo.tags.map((photoTag) => ({
        id: photoTag.tag.id,
        name: photoTag.tag.name,
      })),
      renditions: photo.renditions,
      createdAt: photo.createdAt.toISOString(),
      updatedAt: photo.updatedAt.toISOString(),
    }));
  }

  /** 按传入顺序重写专辑内照片的 sortOrder（要求传入该专辑的全部照片 id）。 */
  async reorderPhotos(
    albumId: string,
    input: ReorderPhotosInput,
  ): Promise<void> {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true },
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }

    const uniqueIds = [...new Set(input.photoIds)];
    if (uniqueIds.length !== input.photoIds.length) {
      throw new NotFoundException("photoIds 存在重复");
    }

    const photos = await this.prisma.photo.findMany({
      where: { id: { in: input.photoIds } },
      select: { id: true, albumId: true },
    });

    if (photos.length !== input.photoIds.length) {
      throw new NotFoundException("存在不存在的照片");
    }
    if (photos.some((photo) => photo.albumId !== albumId)) {
      throw new NotFoundException("存在不属于该专辑的照片");
    }

    await this.prisma.$transaction(
      input.photoIds.map((photoId, index) =>
        this.prisma.photo.update({
          where: { id: photoId },
          data: { sortOrder: index },
        }),
      ),
    );
  }
}
