import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import type { SiteSetting, UpdateSiteSettingInput } from "@photo/shared";
import { updateSiteSettingInputSchema } from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { SettingsService } from "./settings.service.js";

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
}
