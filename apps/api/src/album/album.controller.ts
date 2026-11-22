import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type {
  AddAlbumPhotosInput,
  Album,
  AlbumPhoto,
  CreateAlbumInput,
  RemoveAlbumPhotosInput,
  ReorderPhotosInput,
  UpdateAlbumInput,
} from "@photo/shared";
import {
  addAlbumPhotosInputSchema,
  createAlbumInputSchema,
  removeAlbumPhotosInputSchema,
  reorderPhotosInputSchema,
  updateAlbumInputSchema,
} from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AlbumService } from "./album.service.js";

@Controller("admin/albums")
@UseGuards(AdminGuard)
export class AlbumController {
  constructor(private readonly albumService: AlbumService) {}

  @Get()
  list(): Promise<Album[]> {
    return this.albumService.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createAlbumInputSchema)) body: CreateAlbumInput,
  ): Promise<Album> {
    return this.albumService.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<Album> {
    return this.albumService.get(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAlbumInputSchema)) body: UpdateAlbumInput,
  ): Promise<Album> {
    return this.albumService.update(id, body);
  }

  /** 删除专辑 = 站内下架：成员关系级联，照片保留在照片库，网盘零调用。 */
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<void> {
    await this.albumService.remove(id);
  }

  /** 轮换分享 token，旧链接立即失效。 */
  @Post(":id/share-token")
  rotateShareToken(@Param("id") id: string): Promise<Album> {
    return this.albumService.rotateShareToken(id);
  }

  @Get(":id/photos")
  getPhotos(@Param("id") id: string): Promise<AlbumPhoto[]> {
    return this.albumService.getPhotos(id);
  }

  /** 挑图入专辑（追加到末尾）。 */
  @Post(":id/photos")
  addPhotos(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addAlbumPhotosInputSchema))
    body: AddAlbumPhotosInput,
  ): Promise<void> {
    return this.albumService.addPhotos(id, body);
  }

  /** 移出成员（照片保留在照片库）。 */
  @Post(":id/photos/remove")
  removePhotos(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(removeAlbumPhotosInputSchema))
    body: RemoveAlbumPhotosInput,
  ): Promise<void> {
    return this.albumService.removePhotos(id, body);
  }

  @Post(":id/photos/reorder")
  reorderPhotos(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reorderPhotosInputSchema))
    body: ReorderPhotosInput,
  ): Promise<void> {
    return this.albumService.reorderPhotos(id, body);
  }
}
