import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { apiHealthSchema } from "@photo/shared";

type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  const healthSchema = apiHealthSchema.meta({ id: "ApiHealth" });

  registry.registerPath({
    method: "get",
    path: "/api/health",
    summary: "Health check",
    tags: ["system"],
    responses: {
      200: {
        description: "API is healthy",
        content: {
          "application/json": {
            schema: healthSchema,
          },
        },
      },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "江流儿摄影 API",
      version: "0.1.0",
      description: "Personal photography portfolio API",
    },
    servers: [{ url: "/" }],
  });
}
