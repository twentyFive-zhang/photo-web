import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { BaiduModule } from "../baidu/baidu.module.js";
import { NetdiskController } from "./netdisk.controller.js";
import { NetdiskProcessor } from "./netdisk.processor.js";
import { NetdiskSyncService } from "./netdisk-sync.service.js";

/**
 * 网盘镜像同步（M5.5，ADR 0002）：上行推送 / 下行扫描 / 改名移动传播。
 * 复用全局 Prisma/Storage；processor 在本进程内，M6 可随 import 队列一起拆出。
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: "netdisk-sync" }, { name: "import" }),
    BaiduModule,
  ],
  controllers: [NetdiskController],
  providers: [NetdiskSyncService, NetdiskProcessor],
  exports: [NetdiskSyncService],
})
export class NetdiskModule {}
