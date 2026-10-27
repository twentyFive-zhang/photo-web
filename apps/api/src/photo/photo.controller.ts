import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import type {
  BatchDeletePhotosInput,
  BatchMovePhotosInput,
  Photo,
  SetPhotoTagsInput,
  UpdatePhotoInput,
} from "@photo/shared";
import {
  batchDeletePhotosInputSchema,
  batchMovePhotosInputSchema,
  setPhotoTagsInputSchema,
  updatePhotoInputSchema,
} from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { PhotoService } from "./photo.service.js";

@Controller("admin/photos")
@UseGuards(AdminGuard)
export class PhotoController {
  constructor(private readonly photoService: PhotoService) {}

  @Get(":id")
  get(@Param("id") id: string): Promise<Photo> {
    return this.photoService.get(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePhotoInputSchema)) body: UpdatePhotoInput,
  ): Promise<Photo> {
    return this.photoService.update(id, body);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<void> {
    await this.photoService.remove(id);
  }

  @Put(":id/tags")
  setTags(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setPhotoTagsInputSchema))
    body: SetPhotoTagsInput,
  ): Promise<Photo> {
    return this.photoService.setTags(id, body);
  }

  @Post("batch-move")
  @HttpCode(HttpStatus.OK)
  batchMove(
    @Body(new ZodValidationPipe(batchMovePhotosInputSchema))
    body: BatchMovePhotosInput,
  ): Promise<{ moved: number }> {
    return this.photoService
      .batchMove(body.photoIds, body.targetAlbumId)
      .then((moved) => ({ moved }));
  }

  @Post("batch-delete")
  @HttpCode(HttpStatus.OK)
  batchDelete(
    @Body(new ZodValidationPipe(batchDeletePhotosInputSchema))
    body: BatchDeletePhotosInput,
  ): Promise<{ deleted: number }> {
    return this.photoService
      .batchDelete(body.photoIds)
      .then((deleted) => ({ deleted }));
  }
}
