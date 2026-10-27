import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PhotoController } from "./photo.controller.js";
import { PhotoService } from "./photo.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PhotoController],
  providers: [PhotoService],
})
export class PhotoModule {}
