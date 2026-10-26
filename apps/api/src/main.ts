import { timingSafeEqual } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { AppModule } from "./app.module.js";
import { buildOpenApiDocument } from "./openapi.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");

  const config = app.get(ConfigService);
  const siteUrl = config.get<string>("SITE_URL", "http://localhost:3000");
  const adminUrl = config.get<string>(
    "ADMIN_URL",
    "http://localhost:5173/admin",
  );
  const adminOrigin = new URL(adminUrl).origin;

  app.enableCors({
    origin: [siteUrl, adminOrigin],
    credentials: true,
  });

  if (config.get<boolean>("SWAGGER_ENABLED", true)) {
    const nodeEnv = config.get<string>("NODE_ENV", "development");
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
