import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { CreateBaiduImportInput, ImportJob } from "@photo/shared";
import { createBaiduImportInputSchema } from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ImportService } from "./import.service.js";

@Controller("admin/imports")
@UseGuards(AdminGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post("baidu")
  createBaiduImport(
    @Body(new ZodValidationPipe(createBaiduImportInputSchema))
    body: CreateBaiduImportInput,
  ): Promise<ImportJob> {
    return this.importService.createBaiduImport(body);
  }

  @Get(":jobId")
  getJob(@Param("jobId") jobId: string): Promise<ImportJob> {
    return this.importService.getJob(jobId);
  }

  @Post(":jobId/retry")
  retry(@Param("jobId") jobId: string): Promise<ImportJob> {
    return this.importService.retry(jobId);
  }
}

@Controller("admin/albums")
@UseGuards(AdminGuard)
export class AlbumImportsController {
  constructor(private readonly importService: ImportService) {}

  @Get(":albumId/imports")
  listByAlbum(
    @Param("albumId") albumId: string,
    @Query("take") take?: string,
  ): Promise<ImportJob[]> {
    const limit = Number.parseInt(take ?? "5", 10);
    return this.importService.listByAlbum(
      albumId,
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 5,
    );
  }
}
