import { Module } from "@nestjs/common";
import { BaiduController } from "./baidu.controller.js";
import { BaiduApiService } from "./baidu-api.service.js";
import { BaiduCredentialService } from "./baidu-credential.service.js";
import { BaiduDownloadService } from "./baidu-download.service.js";

/** 百度网盘接入：API 客户端 + 凭证管理 + 原件下载段 + OAuth/浏览端点。 */
@Module({
  controllers: [BaiduController],
  providers: [BaiduApiService, BaiduCredentialService, BaiduDownloadService],
  exports: [BaiduApiService, BaiduCredentialService, BaiduDownloadService],
})
export class BaiduModule {}
