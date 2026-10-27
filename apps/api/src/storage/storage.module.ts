import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service.js";

/** 全局模块：存储在多个 feature 间共享（photo、settings 二维码等）。 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
