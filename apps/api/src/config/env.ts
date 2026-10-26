import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://photo:photo@localhost:5432/photo?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SITE_URL: z.url().default("http://localhost:3000"),
  ADMIN_URL: z.url().default("http://localhost:5173/admin"),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default("dev-only-session-secret-change-me-32"),
  APP_ENCRYPTION_KEY: z.string().min(16).default("dev-only-encryption-key"),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().optional(),
  SWAGGER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SWAGGER_USER: z.string().default("admin"),
  SWAGGER_PASSWORD: z.string().optional(),
  BAIDU_APP_KEY: z.string().optional(),
  BAIDU_APP_SECRET: z.string().optional(),
  BAIDU_REDIRECT_URI: z.url().optional(),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  CDN_BASE_URL: z.url().default("http://localhost:3001/media"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }
  return parsed.data;
}
