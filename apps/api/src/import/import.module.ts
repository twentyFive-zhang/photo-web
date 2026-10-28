import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { BaiduModule } from "../baidu/baidu.module.js";
import { PhotoModule } from "../photo/photo.module.js";
import {
  AlbumImportsController,
  ImportController,
} from "./import.controller.js";
import { ImportProcessor } from "./import.processor.js";
import { ImportService } from "./import.service.js";

/**
 * 导入任务：BullMQ 队列 + processor 跑在本 API 进程内（单管理员规模够用）。
 * ImportModule 自包含，M6 需要时可拆出独立 worker 入口。
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: "import" }),
    BaiduModule,
    PhotoModule,
  ],
  controllers: [ImportController, AlbumImportsController],
  providers: [ImportService, ImportProcessor],
  exports: [ImportService],
})
export class ImportModule {}
