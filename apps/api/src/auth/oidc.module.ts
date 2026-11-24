import { Global, Module } from "@nestjs/common";
import { OidcService } from "./oidc.service.js";

/**
 * 全局模块：OidcService 同时被 AuthController（登录流）和 AdminGuard（会话回查，
 * guard 经 @UseGuards 类引用在各个业务模块里实例化）注入，所以走 @Global。
 */
@Global()
@Module({
  providers: [OidcService],
  exports: [OidcService],
})
export class OidcModule {}
