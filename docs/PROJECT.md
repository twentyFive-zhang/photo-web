# photo-web 项目上下文

> 最后更新：2026-10-27
> 基线提交：`e1324a2 chore: scaffold photo-web monorepo`
> 当前阶段：里程碑 1 已完成，准备进入里程碑 2

## 1. 项目目标

个人摄影作品站，包含三部分：

- 公开 Web 作品集：`jiangliuer.com`
- 单管理员后台：导入、整理、发布照片
- 微信小程序二期：只读浏览，不上传

核心约束：

- 照片母版在百度网盘；网盘只做导入源，不做运行时图床。
- 国内访问优先；腾讯云 + COS/CDN；个人 ICP 备案。
- 访客无需登录；未公开专辑用“仅链接可见”承载。

## 2. 已确认的产品决策

### 站点与内容

- **Q1**：公开作品集为主；访客不登录；私密内容用“仅链接可见”，不做密码相册。
- **Q2**：第一版做 Web 展示 + 后台；微信小程序二期，用 Taro，只浏览不上传。
- **Q3**：国内优先，微信分享是主要传播渠道；海外访问次要。
- **Q4**：以专辑为核心；首页人工精选 + 最新专辑；标签辅助。
- **Q9**：“专辑”和“系列”是同一个概念，统一叫“专辑”，不建层级。
- **Q10**：精选是全站独立列表，照片可来自任意专辑，顺序人工排。
- **Q18**：访客端第一版：首页（精选 + 最新）、专辑列表/详情、照片灯箱、关于/联系、分享卡片；不做搜索/评论。
- **Q19**：新专辑默认“仅链接可见”，整理好后切“公开”；不设独立草稿状态。
- **Q24**：标签显示在照片/灯箱页，第一版不可点击筛选；自由输入，自动补全。
- **Q25**：一张照片只属于一个专辑；批量移动 = 换专辑；精选是唯一跨专辑集合。
- **Q26**：纯个人展示，个人 ICP 备案；不放报价、接单等商业内容。
- **Q28**：“最新”按最近公开的专辑，不按照片流。

### 照片与导入

- **Q5 / Q8**：百度网盘只做源文件库；后台通过 API 导入发布库，不在页面直链网盘。
- **Q11**：导入粒度：手动多选网盘照片/文件夹到指定专辑；失败可重试；本地上传兜底；不做全盘自动扫描。
- **Q12**：发布库保存导入原件 + 三档展示图；网盘保留母版/RAW；支持 JPEG/PNG/WebP，HEIC 转 JPEG；不收 RAW。
- **Q13**：EXIF 展示相机/镜头/光圈/快门/ISO/拍摄时间；隐藏 GPS；不提供原图下载。
- **Q20**：后台第一版：登录、网盘导入 + 本地上传、专辑 CRUD（标题/描述/封面/可见性）、照片排序/批量删除/批量移动、精选排序、照片标题/说明、标签管理；不做 EXIF 手动修正。
- **Q21**：百度开放平台应用还没申请；需注册并申请文件读取/下载权限；本地上传必须独立可用。
- **Q7**：单管理员，不做角色权限；表里保留 `owner/created_by` 字段。
- **补充**：增加最小站点设置页（站点名、简介、关于、邮箱、微信二维码、社交链接），否则关于/联系页只能写死在代码里。

### 访问与发布

- 公开专辑和“仅链接可见”专辑使用不同入口；仅链接专辑需要不可猜测的 token。
- 公开内容：专辑、照片、精选、最新、关于/联系。
- 第一版不引入测试框架，用手动验收 + 脚本 smoke test。

## 3. 技术栈与架构

### 前端

- **前台**：Next.js 16.4.3 App Router + React 19 + TypeScript + Tailwind CSS 4；自定义组件，不引 UI 库；SSR/SEO/OG；服务端 `fetch`。
- **后台**：Vite 8.3.5 + React 19 + TypeScript；TanStack Router（code-based）+ TanStack Query + TanStack Table；shadcn/ui（Radix + Tailwind）；React Hook Form + Zod；sonner；lucide-react；挂在 `/admin/`。
- **共享**：`packages/shared` 放 Zod schema 和类型，构建到 `dist`。

### 后端

- NestJS 12 + Prisma 6.19.3 + PostgreSQL 17 + Redis 7。
- 校验：Zod 4.6.7；`packages/shared` 为契约；NestJS 使用自定义 `ZodValidationPipe`；不用 class-validator / nestjs-zod。
- Swagger：`@asteasolutions/zod-to-openapi` 9 + `swagger-ui-express`；OpenAPI 3.1；`/api/docs`；生产环境 Basic Auth。
- 共享 schema 生成 OpenAPI 时使用 `.meta({ id: "SchemaName" })`；不要依赖 `extendZodWithOpenApi` + `.openapi()`，因为 shared 的 Zod 实例原型和 API 的 `z` 实例不一致，`openapi` 方法可能不存在。
- 认证：用户名 + 密码（Argon2id）+ `express-session` + `connect-redis`；HttpOnly/Secure/SameSite=Lax；`@nestjs/throttler`；不用 Passport/JWT。
- 队列：BullMQ + Redis；独立 worker 容器；导入任务。
- 图片：Sharp 生成 400/1600/2560 三档 WebP + JPEG；exifr 提取 EXIF；公开图去元数据；GPS 不落库。
- 存储：`StorageService` 抽象；生产 `cos-nodejs-sdk-v5`，本地 `LocalStorage`。
- API：REST JSON；不引 GraphQL/tRPC。

### 基础设施

- 腾讯云 2C4G Lighthouse，Ubuntu 24.04，Docker Compose。
- Caddy 单域名路径路由：`/api` → API，`/admin` → 后台静态文件，`/` → Next.js。
- COS + CDN；桶私有 + CDN 回源鉴权。
- 每日 `pg_dump` 到 COS，保留 7 天；COS 版本控制。
- 监控：`/api/health` + UptimeRobot + Docker 日志轮转；暂不接 Sentry。
- 生产运行时 Node 24 LTS；镜像 `node:24-bookworm-slim`；Bun 只做包管理/脚本。
- 代码仓库/CI 计划：GitHub + GitHub Actions + 腾讯云 TCR + SSH；尚未配置 remote/CI。
- 工具链：Biome；第一版不引入测试框架；Vitest/Playwright 以后再加。

## 4. 里程碑 1 状态（已完成）

### 已实现

- Bun workspace：`apps/web`、`apps/admin`、`apps/api`、`packages/shared`。
- Next.js 前台骨架：首页占位、metadata/OG、Tailwind。
- Vite 后台骨架：TanStack Router code-based、Query、Table、shadcn 基础依赖、Tailwind、`/admin/`。
- NestJS API：`/api/health`；ConfigModule + Zod env；Prisma service；Swagger `/api/docs` + `/api/docs-json`；生产 Basic Auth。
- Prisma schema：`Admin`、`Album`、`Photo`、`PhotoRendition`、`Tag`、`PhotoTag`、`FeaturedPhoto`、`ImportJob`、`ImportItem`、`BaiduCredential`、`SiteSetting`。
- 初始 migration + seed（admin + site settings）。
- 本地 Postgres/Redis Docker Compose；`.env.example`。
- `GLOSSARY.md`；ADR 0001（百度网盘只做导入源）。

### 验证

- `bun run lint` 通过。
- `bun run build` 通过（shared / web / admin / api）。
- `bun run typecheck` 通过。
- `/api/health` 返回 `{"status":"ok",...}`。
- `/api/docs-json` 返回 OpenAPI 3.1；生产模式无认证 401，Basic Auth 200。
- Postgres/Redis healthy；migration/seed 成功。

### 已知限制与取舍

- **Prisma 固定 6.19.3**：Prisma 7+ 需要 `prisma.config.ts` + driver adapter，后续单独迁移。
- **Docker Hub 当前网络不可达**：本地镜像从 DaoCloud 公开镜像源拉取后打了标准 tag；换机器需配镜像加速或改 compose 的 image 地址。
- **TanStack Router 目前是 code-based**：要 file-based 再换。
- **shadcn/ui 只装基础依赖**：组件还没铺。
- **Next.js 16 Cache Components 已开启**：预渲染页面里不要直接用 `new Date()` 等不稳定值（已踩过；用静态值、`await connection()` 或 `"use cache"`）。
- 百度开放平台应用未申请；百度导入未实现。
- 小程序二期未开始。
- 没有测试框架；没有 remote/CI；没有部署。
- 本地测试 admin 密码不写入文档；以 `.env` 的 `ADMIN_PASSWORD` 为准。

## 5. 仓库结构与命令

```text
photo-web/
├── apps/web           Next.js 前台
├── apps/admin         Vite React 后台
├── apps/api           NestJS API + Prisma
├── packages/shared    Zod schema / 类型
├── docker-compose.yml
├── GLOSSARY.md
└── docs/adr/
```

```bash
cp .env.example .env
bun install
bun run db:up
bun run db:migrate
bun run db:seed
bun run dev
```

- 前台：http://localhost:3000
- 后台：http://localhost:5173/admin/
- API：http://localhost:3001/api/health
- Swagger：http://localhost:3001/api/docs
- 常用：`bun run lint`、`bun run build`、`bun run typecheck`、`bun run db:down`

注意：

- `db:migrate` / `db:seed` 通过 `--env-file=../../.env` 读根 `.env`；先复制 `.env.example`。
- 设置 `SWAGGER_PASSWORD` 后，dev 也走 Basic Auth；生产必须设置。
- `.env` 已被 git 忽略，不要提交。

## 6. 里程碑规划（2026-10-27 重排）

里程碑 1 已完成。原"里程碑 2"过大，已拆分为 M2-M6，按"尽快打通上传→展示纵向切片"排序：

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| **M2 认证 + 内容 CRUD** | 登录/me/改密、专辑/照片/标签/精选/站点设置 CRUD、`publicId`/`shareToken`/`visibility`、排序/批量移动/删除、封面 | Swagger 里能 curl 全套接口，seed 出可见数据 |
| **M3 上传 + 展示（纵向切片）** | 最小本地上传（原件 + 三档 WebP + EXIF）→ 最小前台（专辑详情 + 灯箱） | 从后台上传一张照片，前台能打开看到 |
| **M4 后台完整 + 前台完整** | 排序/批量操作/封面/精选排序、首页/列表页/关于/联系页/SEO/OG、`/s/:shareToken` | 站点达到"能用版本" |
| **M5 百度网盘导入** | OAuth、目录浏览、BullMQ job、进度/重试 | 从网盘导入一个文件夹成功，失败可重试 |
| **M6 部署上线** | Caddy、生产 Compose、COS/CDN、ICP、备份、监控、GitHub remote + CI | jiangliuer.com 可访问 |
| **M7 小程序**（二期） | Taro 只读浏览 | — |

排序理由：M3 的纵向切片尽早暴露高风险项（Sharp 三档图、`StorageService`、Cache Components）；百度导入（M5）复用同一套上传流水线；ICP 备案周期 1-3 周，可与 M3-M5 并行启动。

### 立即行动（不等里程碑开始）

- **现在就申请百度开放平台应用**（文件读取/下载权限），审批周期不可控，M5 的硬前置。
- 域名/ICP 备案、腾讯云账号确认可与服务端开发并行推进。

### 任务分类（GitHub remote 配好后启用）

用 milestone + label 两维：

- 领域 label：`api` / `web` / `admin` / `shared` / `db` / `deploy`
- 类型 label：`feature` / `bug` / `chore` / `docs` / `spike`
- 状态 label：`blocked`（等百度审批、等 ICP）/ `decision`（对应下方待确认项）

remote 配好前不引入任务工具，用本文件 + conventional commit 前缀跟踪。

### 决策任务（对应里程碑开头关闭）

- **M2 开头**：公开 URL 格式（建议 `/albums/:publicId`、`/photos/:publicId`、`/s/:shareToken`）；`shareToken` 是否支持轮换；专辑封面默认规则（是否取第一张、允许空封面）；标签规范化规则（大小写/空白）。—— 均影响 schema，先定后写。
- **M3 开头**：三档图尺寸/质量 —— 直接定为 400/1600/2560，WebP + JPEG，不再悬置。

## 7. 下次启动检查

1. 读 `docs/PROJECT.md`、`GLOSSARY.md`、`docs/adr/0001-baidu-netdisk-as-import-source.md`。
2. 看 `git status` 和 `git log --oneline -3`。
3. 依赖有变动时跑 `bun install`。
4. 没有 `.env` 时 `cp .env.example .env`，填好 secrets。
5. `bun run db:up`，然后 `bun run dev`。
6. 验证 `/api/health`、`/api/docs`、`/admin/`。
7. 从里程碑 2 继续。
