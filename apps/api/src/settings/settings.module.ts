import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";
import { SettingsPublicController } from "./settings-public.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [SettingsController, SettingsPublicController],
  providers: [SettingsService],
})
export class SettingsModule {}
