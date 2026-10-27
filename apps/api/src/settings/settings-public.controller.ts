import { Controller, Get } from "@nestjs/common";
import type { PublicSiteSetting } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { SettingsService } from "./settings.service.js";

/** 公开站点设置：关于/联系页与页头页脚使用。 */
@Controller("settings")
export class SettingsPublicController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Promise<PublicSiteSetting> {
    return this.settingsService.getPublic();
  }
}
