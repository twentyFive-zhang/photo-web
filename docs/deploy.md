# 部署指南（Vercel + Railway 混合）

> 状态：2026-10 起的目标架构。前台/后台上 Vercel，API 带数据库上 Railway。

## 架构

```
Vercel                          Railway
├─ photo-web   (Next.js)        ├─ api       (NestJS，Dockerfile.api)
└─ photo-admin (Vite 静态)      ├─ Postgres  (插件)
                                ├─ Redis     (插件)
                                └─ Volume    (媒体文件，挂载 /data)
```

- **web / admin**：纯前端形态，Vercel 完美适配；web 的 `/media/*` rewrite 兜底同源代理。
- **api**：BullMQ 队列 worker、express-session、媒体写盘（`STORAGE_DIR`）都是长进程 +
  持久磁盘的形态，**不适合 Vercel serverless**，放 Railway 常驻容器。
- 媒体文件存 Railway Volume；M6 切 COS + CDN 后把 `CDN_BASE_URL` 改为 CDN 绝对地址即可。

## Railway：API

1. 新建项目 → **+ New → GitHub Repo**，选本仓库，服务设置的 **Dockerfile Path** 填
   `Dockerfile.api`（构建上下文是仓库根目录）。
2. **+ New → Database → PostgreSQL / Redis** 各加一个，`DATABASE_URL`、`REDIS_URL`
   通过「Reference Variable」引用插件变量（`${{Postgres.DATABASE_URL}}`、
   `${{Redis.REDIS_URL}}`）。
3. **Volumes**：给 api 服务挂 Volume，挂载点 `/data`，并设 `STORAGE_DIR=/data/storage`。
4. Networking → Generate Domain，得到公网地址（下称 `https://<api-domain>`）。

### api 服务环境变量

| 变量                      | 值                           | 说明                                                                                       |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`            | `${{Postgres.DATABASE_URL}}` |                                                                                            |
| `REDIS_URL`               | `${{Redis.REDIS_URL}}`       |                                                                                            |
| `STORAGE_DIR`             | `/data/storage`              | 与 Volume 挂载点配套                                                                       |
| `CDN_BASE_URL`            | `https://<api-domain>/media` | **必须绝对地址**：admin 与 API 跨站，相对路径 `/media/...` 会打到 admin 自己的域名下 404   |
| `SITE_URL`                | web 的 Vercel 地址           | CORS 白名单                                                                                |
| `ADMIN_URL`               | admin 的 Vercel 地址         | CORS 白名单（取 origin）                                                                   |
| `SESSION_COOKIE_SAMESITE` | `none`                       | **默认域名跨站部署时必填**，否则登录态丢失；将来全部迁到同一注册域名的子域名下可改回 `lax` |
| `SESSION_SECRET`          | ≥32 位随机串                 | `openssl rand -base64 32`                                                                  |
| `APP_ENCRYPTION_KEY`      | ≥16 位随机串                 |                                                                                            |
| `ADMIN_PASSWORD`          | 首次 seed 用，可事后删       |                                                                                            |
| `SWAGGER_ENABLED`         | `false`（可选）              | 生产默认也行，但 `SWAGGER_PASSWORD` 必填                                                   |

### 初始化数据

迁移由容器启动命令自动执行（`prisma migrate deploy`）。管理员账号和站点设置在本地
对生产库跑一次 seed（脚本本身是 upsert，可重复执行）：

```sh
DATABASE_URL=<生产 DATABASE_URL> ADMIN_USERNAME=admin ADMIN_PASSWORD=<密码> \
  bun run --cwd apps/api prisma:seed
```

## Vercel：web 与 admin

每个应用建一个独立项目，**Root Directory 分别指向 `apps/web` / `apps/admin`**。
Vercel 识别根目录 `packageManager: bun@1.4.4` 与 workspace 后会在仓库根自动 `bun install`。

### photo-web（Framework: Next.js）

| 变量                   | 值                     | 说明                                                  |
| ---------------------- | ---------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`  | `https://<api-domain>` | 客户端取数 + sitemap，**构建时注入**                  |
| `API_URL`              | `https://<api-domain>` | `/media/*` rewrite 目标，next.config 在**构建时**求值 |
| `NEXT_PUBLIC_SITE_URL` | web 自己的最终域名     | metadata/sitemap/robots；先给默认域名，绑自定义域后改 |

### photo-admin（Framework: Vite）

| 变量                         | 值               | 说明           |
| ---------------------------- | ---------------- | -------------- |
| `VITE_PUBLIC_BASE_URL`       | web 的地址       | 二维码指向前台 |
| `VITE_PUBLIC_ADMIN_BASE_URL` | admin 自己的地址 | 二维码指向后台 |

注意：`NEXT_PUBLIC_*` / `VITE_*` 都参与**构建时**内联，修改变量后需要 Redeploy 才生效。

## 上线顺序与核对

1. Railway：建 api 服务 + 数据库 + Volume，拿到 `<api-domain>`，确认部署健康。
2. 跑 seed（见上）。
3. Vercel：建 web / admin 两个项目，配环境变量（依赖第 1 步的域名）。
4. 回填 CORS：把两个 Vercel 域名填进 api 的 `SITE_URL` / `ADMIN_URL`（api 会自动重启）。
5. 核对清单：
   - [ ] web 首页出图（媒体走 `<api-domain>/media`，或 `/media` rewrite）
   - [ ] admin 登录成功、刷新后仍保持登录（Cookie SameSite 验证）
   - [ ] 上传一张照片：生成 rendition、前台可见（BullMQ + Volume 验证）
   - [ ] 二维码内容是线上前台地址

## 已知取舍

- admin 登录 Cookie 跨站（`SameSite=None`）比同站略弱；根治办法是把 web/admin/api
  绑到**同一个注册域名的三个子域名**（如 `www.` / `admin.` / `api.`），届时改回 `lax`。
- `*.vercel.app` / `*.up.railway.app` 免费域名在国内访问不稳定，正式使用建议绑定
  自定义域名（Vercel/Railway 均支持 CNAME）。
- 媒体暂放 Railway Volume；M6 切 COS 后 `CDN_BASE_URL` 换 CDN 域名，Volume 可退役。
