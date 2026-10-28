import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AlbumModule } from "./album/album.module.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { AuthModule } from "./auth/auth.module.js";
import { BaiduModule } from "./baidu/baidu.module.js";
import { validateEnv } from "./config/env.js";
import { FeaturedModule } from "./featured/featured.module.js";
import { ImportModule } from "./import/import.module.js";
import { NetdiskModule } from "./netdisk/netdisk.module.js";
import { PhotoModule } from "./photo/photo.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { TagModule } from "./tag/tag.module.js";

/** BullMQ 连接参数（ioredis 不直接吃 url 字符串，这里手动拆）。 */
function redisConnectionOptions(config: ConfigService) {
  const url = new URL(
    config.get<string>("REDIS_URL") ?? "redis://localhost:6379",
  );
  const options: Record<string, unknown> = {
    host: url.hostname,
    port: Number(url.port || 6379),
    // BullMQ 官方建议：worker 连接禁用命令级重试，失败由 job attempts 兜底
    maxRetriesPerRequest: null,
  };
  if (url.username && url.username !== "default") {
    options.username = url.username;
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  return options;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
      validate: validateEnv,
    }),
    // 全局限流：每 IP 每分钟 100 次；登录接口单独收紧
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // 导入队列（BullMQ，连接同 Redis；processor 在本进程内，M6 可拆独立 worker）
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionOptions(config),
      }),
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    AlbumModule,
    PhotoModule,
    TagModule,
    FeaturedModule,
    SettingsModule,
    BaiduModule,
    ImportModule,
    NetdiskModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
