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
  Album,
  CreateAlbumInput,
  ReorderPhotosInput,
  UpdateAlbumInput,
} from "@photo/shared";
import {
  createAlbumInputSchema,
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
  getPhotos(@Param("id") id: string) {
    return this.albumService.getPhotos(id);
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
