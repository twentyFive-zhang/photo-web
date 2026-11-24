import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AlbumController } from "./album.controller.js";
import { AlbumService } from "./album.service.js";
import { AlbumPublicController } from "./album-public.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [AlbumController, AlbumPublicController],
  providers: [AlbumService],
  // 导出给 ImportModule：导入附带专辑时由 processor 写成员行（ADR 0007）
  exports: [AlbumService],
})
export class AlbumModule {}
