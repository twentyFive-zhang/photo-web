import { Controller, Get, Param } from "@nestjs/common";
import type { PublicAlbum, PublicAlbumSummary } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AlbumService } from "./album.service.js";

/** 公开只读接口：前台（含未登录访客）使用。 */
@Controller("albums")
export class AlbumPublicController {
  constructor(private readonly albumService: AlbumService) {}

  @Get()
  list(): Promise<PublicAlbumSummary[]> {
    return this.albumService.listPublic();
  }

  @Get(":publicId")
  get(@Param("publicId") publicId: string): Promise<PublicAlbum> {
    return this.albumService.getPublic(publicId);
  }
}
