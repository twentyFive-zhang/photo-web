import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { SiteSetting, UpdateSiteSettingInput } from "@photo/shared";
import { updateSiteSettingInputSchema } from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { SettingsService } from "./settings.service.js";

const QR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

@Controller("admin/settings")
@UseGuards(AdminGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Promise<SiteSetting> {
    return this.settingsService.get();
  }

  @Put()
  update(
    @Body(new ZodValidationPipe(updateSiteSettingInputSchema))
    body: UpdateSiteSettingInput,
  ): Promise<SiteSetting> {
    return this.settingsService.update(body);
  }

  /** 上传微信二维码（multipart，字段 file；PNG/JPEG/WebP）。 */
  @Put("qr")
  @UseInterceptors(FileInterceptor("file"))
  updateQr(@UploadedFile() file?: Express.Multer.File): Promise<SiteSetting> {
    if (!file || !QR_MIME.has(file.mimetype)) {
      throw new BadRequestException("缺少文件字段 file 或类型不支持");
    }
    return this.settingsService.updateQr(file);
  }
}
