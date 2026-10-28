import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NetdiskModule } from "../netdisk/netdisk.module.js";
import { PhotoModule } from "../photo/photo.module.js";
import { AlbumController } from "./album.controller.js";
import { AlbumService } from "./album.service.js";
import { AlbumPublicController } from "./album-public.controller.js";

@Module({
  imports: [AuthModule, PhotoModule, NetdiskModule],
  controllers: [AlbumController, AlbumPublicController],
  providers: [AlbumService],
})
export class AlbumModule {}
