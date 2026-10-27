import { Controller, Get, Param } from "@nestjs/common";
import type { PublicAlbum, PublicAlbumSummary } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AlbumService } from "./album.service.js";

/** 公开只读接口：前台（含未登录访客）使用。 */
@Controller()
export class AlbumPublicController {
  constructor(private readonly albumService: AlbumService) {}

  @Get("albums")
  list(): Promise<PublicAlbumSummary[]> {
    return this.albumService.listPublic();
  }

  @Get("albums/:publicId")
  get(@Param("publicId") publicId: string): Promise<PublicAlbum> {
    return this.albumService.getPublic(publicId);
  }

  /** 仅链接可见专辑的分享入口（/s/:shareToken 页面使用）。 */
  @Get("share/:shareToken")
  getByShareToken(
    @Param("shareToken") shareToken: string,
  ): Promise<PublicAlbum> {
    return this.albumService.getPublicByShareToken(shareToken);
  }
}
