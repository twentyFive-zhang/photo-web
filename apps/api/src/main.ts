import { timingSafeEqual } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { RedisStore } from "connect-redis";
import type { NextFunction, Request, Response } from "express";
import session from "express-session";
import { createClient } from "redis";
import swaggerUi from "swagger-ui-express";
import { AppModule } from "./app.module.js";
import { buildOpenApiDocument } from "./openapi.js";
import { StorageService } from "./storage/storage.service.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api");

  const config = app.get(ConfigService);
  const siteUrl = config.get<string>("SITE_URL", "http://localhost:3000");
  const adminUrl = config.get<string>(
    "ADMIN_URL",
    "http://localhost:5173/admin",
  );
  const adminOrigin = new URL(adminUrl).origin;
  const nodeEnv = config.get<string>("NODE_ENV", "development");

  app.enableCors({
    origin: [siteUrl, adminOrigin],
    credentials: true,
  });

  // 生产环境在 Caddy 反代后面，信任第一层代理以获得真实 IP（限流依赖）
  if (nodeEnv === "production") {
    const expressInstance = app.getHttpAdapter().getInstance();
    expressInstance.set("trust proxy", 1);
  }

  // 管理员 session：Redis 存储，HttpOnly/Secure；SameSite 由 SESSION_COOKIE_SAMESITE 配置
  // connect-redis v10 只支持 node-redis（ioredis 留给 M5 的 BullMQ）
  const redis = createClient({ url: config.getOrThrow<string>("REDIS_URL") });
  await redis.connect();
  app.use(
    session({
      store: new RedisStore({ client: redis, prefix: "photo:sess:" }),
      secret: config.getOrThrow<string>("SESSION_SECRET"),
      name: "photo.sid",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: nodeEnv === "production",
        sameSite: config.getOrThrow<"lax" | "strict" | "none">(
          "SESSION_COOKIE_SAMESITE",
        ),
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // 本地存储的公开文件（rendition / 原件）；M6 换 COS + CDN 后由 CDN 回源
  // biome-ignore lint/correctness/useHookAtTopLevel: NestJS 静态资源挂载方法，非 React hook
  app.useStaticAssets(app.get(StorageService).rootPath, { prefix: "/media" });

  if (config.get<boolean>("SWAGGER_ENABLED", true)) {
    const swaggerUser = config.get<string>("SWAGGER_USER", "admin");
    const swaggerPassword = config.get<string>("SWAGGER_PASSWORD");

    if (nodeEnv === "production" && !swaggerPassword) {
      throw new Error(
        "SWAGGER_PASSWORD is required when Swagger is enabled in production",
      );
    }

    const auth = swaggerPassword
      ? basicAuth(swaggerUser, swaggerPassword)
      : (_req: Request, _res: Response, next: NextFunction) => next();

    const document = buildOpenApiDocument();
    app.use("/api/docs", auth, swaggerUi.serve, swaggerUi.setup(document));
    app.use("/api/docs-json", auth, (_req: Request, res: Response) => {
      res.json(document);
    });
  }

  const port = config.get<number>("PORT", 3001);
  await app.listen(port);
}

function basicAuth(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="API docs"');
      res.status(401).send("Authentication required");
      return;
    }

    const [user, pass] = Buffer.from(header.slice(6), "base64")
      .toString()
      .split(":");

    if (safeEqual(user, username) && safeEqual(pass, password)) {
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="API docs"');
    res.status(401).send("Authentication required");
  };
}

function safeEqual(value: string | undefined, expected: string): boolean {
  if (value === undefined) {
    return false;
  }

  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

await bootstrap();
