import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AlbumController } from "./album.controller.js";
import { AlbumService } from "./album.service.js";

@Module({
  imports: [AuthModule],
  controllers: [AlbumController],
  providers: [AlbumService],
})
export class AlbumModule {}
