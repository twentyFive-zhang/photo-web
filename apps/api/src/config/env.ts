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
  // 统一登录（OIDC，身份源 = Authentik）：缺省值与 admin-gate bootstrap 注册结果一致。
  // issuer 带「尾斜杠」——Authentik per-app issuer 的 discovery 文档原样返回尾斜杠，
  // openid-client 严格比对 issuer，两边必须完全一致
  OIDC_ISSUER: z.url().default("http://id.localhost/application/o/photo-web/"),
  OIDC_CLIENT_ID: z.string().default("photo-web"),
  OIDC_CLIENT_SECRET: z.string().optional(),
  // groups claim 随 profile scope 下发（Authentik 2026.8 无字面 groups scope）
  OIDC_SCOPES: z.string().default("openid profile"),
  // 回调落在 API 直达地址：admin SPA(:5173) 经 vite proxy 调 API，session cookie 按
  // host 作用域（localhost，端口无关），:3001 回调写下的 cookie 对 :5173 同样生效
  OIDC_REDIRECT_URI: z.url().default("http://localhost:3001/api/auth/callback"),
  // OIDC 登录准入组（userinfo groups claim）
  OIDC_ADMIN_GROUP: z.string().default("photo-web-admin"),
  // 会话回查（fail-closed）：用 service account token 查 Authentik Core API，
  // 确认用户仍 active 且仍在准入组；Authentik 异常时 502，用户失效时 401
  AUTHENTIK_API_URL: z.url().default("http://id.localhost/api/v3"),
  AUTHENTIK_API_TOKEN: z.string().optional(),
  SWAGGER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SWAGGER_USER: z.string().default("admin"),
  SWAGGER_PASSWORD: z.string().optional(),
  BAIDU_APP_KEY: z.string().optional(),
  BAIDU_APP_SECRET: z.string().optional(),
  BAIDU_REDIRECT_URI: z.url().optional(),
  // 应用名 = 网盘里 /我的应用数据/{应用名}/ 的目录名；创建应用时填写的名称
  BAIDU_APP_NAME: z.string().optional(),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  // 相对路径 = 同源 /media（dev 由 web/admin 代理到 API）；生产配 CDN 绝对地址
  CDN_BASE_URL: z.string().default("/media"),
  // 本地磁盘存储根目录（相对 API 进程 cwd）；生产 COS 部署后仅作上传暂存
  STORAGE_DIR: z.string().default("var/storage"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }
  return parsed.data;
}
