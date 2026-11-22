import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AddAlbumPhotosInput,
  Album,
  AlbumPhoto,
  CreateAlbumInput,
  PhotoSummary,
  PublicAlbum,
  PublicAlbumSummary,
  PublicPhoto,
  RemoveAlbumPhotosInput,
  ReorderPhotosInput,
  UpdateAlbumInput,
} from "@photo/shared";
import { Prisma } from "@prisma/client";
import { generatePublicId, generateShareToken } from "../common/id.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PrismaService } from "../prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { StorageService } from "../storage/storage.service.js";

const isUniqueViolation = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

/** 生效封面回落来源：成员排序第一张（带 THUMB rendition 供列表缩略图）。 */
const albumInclude = {
  coverPhoto: {
    include: { renditions: { where: { variant: "THUMB" as const } } },
  },
  members: {
    // 封面回落：成员排序第一张
    take: 1,
    orderBy: { sortOrder: "asc" as const },
    select: { photo: { select: { id: true, publicId: true, title: true } } },
  },
  _count: { select: { members: true } },
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

/** 生效封面：手动 coverPhotoId 优先，否则成员排序第一张，空专辑为 null。 */
function resolveCover(album: AlbumWithCover): PhotoSummary | null {
  if (album.coverPhoto) {
    return toPhotoSummary(album.coverPhoto);
  }
  return album.members[0] ? toPhotoSummary(album.members[0].photo) : null;
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
    photoCount: album._count.members,
    createdAt: album.createdAt.toISOString(),
    updatedAt: album.updatedAt.toISOString(),
  };
}

async function requireAlbum(
  prisma: PrismaService,
  albumId: string,
): Promise<{ id: string; publishedAt: Date | null }> {
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: { id: true, publishedAt: true },
  });
  if (!album) {
    throw new NotFoundException("专辑不存在");
  }
  return album;
}

@Injectable()
export class AlbumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

  /**
   * 更新专辑元数据（ADR 0006：改名是纯站内操作，零网盘 API 调用）。
   * coverPhotoId 必须指向本专辑成员照片（封面仍是 Album 字段）。
   */
  async update(id: string, input: UpdateAlbumInput): Promise<Album> {
    const existing = await requireAlbum(this.prisma, id);

    if (input.coverPhotoId) {
      const member = await this.prisma.albumPhoto.findUnique({
        where: {
          albumId_photoId: { albumId: id, photoId: input.coverPhotoId },
        },
        select: { photoId: true },
      });
      if (!member) {
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

  /**
   * 删除专辑 = 仅站内下架：删专辑行（成员关系级联），照片保留在照片库，
   * 网盘侧零调用（ADR 0006 解耦 + 删除不碰网盘不变量）。
   */
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

  /** 专辑成员照片：按成员关系 sortOrder 输出（形状同 shared AlbumPhoto）。 */
  async getPhotos(albumId: string) {
    await requireAlbum(this.prisma, albumId);

    const members = await this.prisma.albumPhoto.findMany({
      where: { albumId },
      orderBy: { sortOrder: "asc" },
      include: {
        photo: {
          include: {
            renditions: true,
            tags: { include: { tag: true } },
            memberships: {
              orderBy: { createdAt: "asc" as const },
              include: {
                album: { select: { id: true, publicId: true, title: true } },
              },
            },
          },
        },
      },
    });

    return members.map(({ photo, sortOrder }) => ({
      id: photo.id,
      publicId: photo.publicId,
      albums: photo.memberships.map(({ album }) => album),
      title: photo.title,
      caption: photo.caption,
      originalKey: photo.originalKey,
      sha256: photo.sha256,
      width: photo.width,
      height: photo.height,
      exif: (photo.exif as AlbumPhoto["exif"]) ?? null,
      renditions: photo.renditions,
      tags: photo.tags.map((photoTag) => ({
        id: photoTag.tag.id,
        name: photoTag.tag.name,
      })),
      sortOrder,
      createdAt: photo.createdAt.toISOString(),
      updatedAt: photo.updatedAt.toISOString(),
    }));
  }

  /** 加入成员（追加到专辑末尾）；已是成员的照片自动忽略。 */
  async addPhotos(albumId: string, input: AddAlbumPhotosInput): Promise<void> {
    await requireAlbum(this.prisma, albumId);

    const existingPhotos = await this.prisma.photo.findMany({
      where: { id: { in: input.photoIds } },
      select: { id: true },
    });
    if (existingPhotos.length !== input.photoIds.length) {
      throw new NotFoundException("存在不存在的照片");
    }

    const maxRow = await this.prisma.albumPhoto.aggregate({
      where: { albumId },
      _max: { sortOrder: true },
    });
    let next = (maxRow._max.sortOrder ?? -1) + 1;

    await this.prisma.$transaction(
      input.photoIds.map((photoId) =>
        this.prisma.albumPhoto.upsert({
          where: { albumId_photoId: { albumId, photoId } },
          update: {},
          create: { albumId, photoId, sortOrder: next++ },
        }),
      ),
    );
  }

  /** 移出成员：只拆成员关系，照片本身保留在照片库。 */
  async removePhotos(
    albumId: string,
    input: RemoveAlbumPhotosInput,
  ): Promise<void> {
    await requireAlbum(this.prisma, albumId);
    await this.prisma.albumPhoto.deleteMany({
      where: { albumId, photoId: { in: input.photoIds } },
    });
  }

  /** 按传入顺序重写成员关系 sortOrder（要求传入该专辑全部成员照片 id）。 */
  async reorderPhotos(
    albumId: string,
    input: ReorderPhotosInput,
  ): Promise<void> {
    await requireAlbum(this.prisma, albumId);

    const uniqueIds = [...new Set(input.photoIds)];
    if (uniqueIds.length !== input.photoIds.length) {
      throw new NotFoundException("photoIds 存在重复");
    }

    const members = await this.prisma.albumPhoto.findMany({
      where: { albumId, photoId: { in: input.photoIds } },
      select: { photoId: true },
    });
    if (members.length !== input.photoIds.length) {
      throw new NotFoundException("存在不属于该专辑的照片");
    }

    await this.prisma.$transaction(
      input.photoIds.map((photoId, index) =>
        this.prisma.albumPhoto.update({
          where: { albumId_photoId: { albumId, photoId } },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  // ---- 公开视图（无需登录） ----

  private thumbUrlOf(coverPhoto: {
    renditions: { variant: string; key: string }[];
  }): string | null {
    const thumb = coverPhoto.renditions.find((r) => r.variant === "THUMB");
    return thumb ? this.storage.publicUrl(thumb.key) : null;
  }

  /** 公开专辑列表（按发布时间倒序），用于前台专辑列表与首页。 */
  async listPublic(): Promise<PublicAlbumSummary[]> {
    const albums = await this.prisma.album.findMany({
      where: { visibility: "PUBLIC" },
      orderBy: { publishedAt: "desc" },
      include: {
        coverPhoto: {
          include: { renditions: { where: { variant: "THUMB" as const } } },
        },
        members: {
          // 封面回落：成员排序第一张
          take: 1,
          orderBy: { sortOrder: "asc" as const },
          include: {
            photo: {
              include: { renditions: { where: { variant: "THUMB" as const } } },
            },
          },
        },
        _count: { select: { members: true } },
      },
    });

    return albums.map((album) => ({
      publicId: album.publicId,
      title: album.title,
      description: album.description,
      photoCount: album._count.members,
      publishedAt: album.publishedAt?.toISOString() ?? null,
      coverUrl: album.coverPhoto
        ? this.thumbUrlOf(album.coverPhoto)
        : album.members[0]
          ? this.thumbUrlOf(album.members[0].photo)
          : null,
    }));
  }

  /** 公开专辑详情：publicId 即入口（公开 / 仅链接可见均可访问）。 */
  async getPublic(publicId: string): Promise<PublicAlbum> {
    const album = await this.prisma.album.findUnique({
      where: { publicId },
      include: this.publicMembersInclude(),
    });
    if (!album) {
      throw new NotFoundException("专辑不存在");
    }
    return this.toPublicAlbum(album);
  }

  /** 仅链接可见专辑入口：24 位 shareToken，不可猜测。 */
  async getPublicByShareToken(shareToken: string): Promise<PublicAlbum> {
    const album = await this.prisma.album.findUnique({
      where: { shareToken },
      include: this.publicMembersInclude(),
    });
    if (!album) {
      throw new NotFoundException("专辑不存在或链接已失效");
    }
    return this.toPublicAlbum(album);
  }

  private publicMembersInclude() {
    return {
      members: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          photo: {
            include: {
              renditions: true,
              tags: { include: { tag: true } },
            },
          },
        },
      },
    } satisfies Prisma.AlbumInclude;
  }

  private toPublicAlbum(album: {
    publicId: string;
    title: string;
    description: string | null;
    publishedAt: Date | null;
    members: {
      sortOrder: number;
      photo: {
        publicId: string;
        title: string | null;
        caption: string | null;
        width: number;
        height: number;
        exif: unknown;
        renditions: {
          variant: "THUMB" | "DISPLAY";
          format: "WEBP" | "JPEG";
          width: number;
          height: number;
          bytes: number;
          key: string;
        }[];
        tags: { tag: { id: string; name: string } }[];
      };
    }[];
  }): PublicAlbum {
    const photos: PublicPhoto[] = album.members.map(({ photo, sortOrder }) => ({
      publicId: photo.publicId,
      title: photo.title,
      caption: photo.caption,
      width: photo.width,
      height: photo.height,
      exif: (photo.exif as PublicPhoto["exif"]) ?? null,
      sortOrder,
      renditions: photo.renditions.map((rendition) => ({
        variant: rendition.variant,
        format: rendition.format,
        width: rendition.width,
        height: rendition.height,
        bytes: rendition.bytes,
        url: this.storage.publicUrl(rendition.key),
      })),
      tags: photo.tags.map(({ tag }) => ({ id: tag.id, name: tag.name })),
    }));

    return {
      publicId: album.publicId,
      title: album.title,
      description: album.description,
      publishedAt: album.publishedAt?.toISOString() ?? null,
      photos,
    };
  }
}
