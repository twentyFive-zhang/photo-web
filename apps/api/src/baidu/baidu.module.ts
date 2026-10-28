import { Module } from "@nestjs/common";
import { BaiduController } from "./baidu.controller.js";
import { BaiduApiService } from "./baidu-api.service.js";
import { BaiduCredentialService } from "./baidu-credential.service.js";

/** 百度网盘接入：API 客户端 + 凭证管理 + OAuth/浏览端点。 */
@Module({
  controllers: [BaiduController],
  providers: [BaiduApiService, BaiduCredentialService],
  exports: [BaiduApiService, BaiduCredentialService],
})
export class BaiduModule {}
