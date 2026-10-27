import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  Album,
  CreateAlbumInput,
  Photo,
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
import { PhotoService } from "../photo/photo.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AlbumService } from "./album.service.js";

@Controller("admin/albums")
@UseGuards(AdminGuard)
export class AlbumController {
  constructor(
    private readonly albumService: AlbumService,
    private readonly photoService: PhotoService,
  ) {}

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

  /** 本地上传（multipart，字段名 file）；可重复调用，sortOrder 依次追加。 */
  @Post(":id/photos/upload")
  @UseInterceptors(FileInterceptor("file"))
  uploadPhoto(
    @Param("id") id: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Photo> {
    if (!file) {
      throw new BadRequestException("缺少文件字段 file");
    }
    return this.photoService.upload(id, file);
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
