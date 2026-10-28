import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NetdiskModule } from "../netdisk/netdisk.module.js";
import { PhotoController } from "./photo.controller.js";
import { PhotoService } from "./photo.service.js";
import { PhotoProcessingService } from "./photo-processing.service.js";

@Module({
  imports: [AuthModule, NetdiskModule],
  controllers: [PhotoController],
  providers: [PhotoService, PhotoProcessingService],
  exports: [PhotoService],
})
export class PhotoModule {}
