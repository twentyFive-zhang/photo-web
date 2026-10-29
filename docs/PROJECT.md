# photo-web 项目上下文

> 最后更新：2026-10-28
> 基线提交：`e1324a2 chore: scaffold photo-web monorepo`
> 当前阶段：M1-M4 完成；M4 后体验增强（二维码/手机端/UX）完成；准备进入 M5

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

## 4. 里程碑状态

### M1（已完成）

#### 已实现

- Bun workspace：`apps/web`、`apps/admin`、`apps/api`、`packages/shared`。
- Next.js 前台骨架：首页占位、metadata/OG、Tailwind。
- Vite 后台骨架：TanStack Router code-based、Query、Table、shadcn 基础依赖、Tailwind、`/admin/`。
- NestJS API：`/api/health`；ConfigModule + Zod env；Prisma service；Swagger `/api/docs` + `/api/docs-json`；生产 Basic Auth。
- Prisma schema：`Admin`、`Album`、`Photo`、`PhotoRendition`、`Tag`、`PhotoTag`、`FeaturedPhoto`、`ImportJob`、`ImportItem`、`BaiduCredential`、`SiteSetting`。
- 初始 migration + seed（admin + site settings）。
- 本地 Postgres/Redis Docker Compose；`.env.example`。
- `GLOSSARY.md`；ADR 0001（百度网盘只做导入源）。

#### 验证

- `bun run lint` 通过。
- `bun run build` 通过（shared / web / admin / api）。
- `bun run typecheck` 通过。
- `/api/health` 返回 `{"status":"ok",...}`。
- `/api/docs-json` 返回 OpenAPI 3.1；生产模式无认证 401，Basic Auth 200。
- Postgres/Redis healthy；migration/seed 成功。

### 已知限制与取舍

- **Prisma 固定 6.19.3**：Prisma 7+ 需要 `prisma.config.ts` + driver adapter，后续单独迁移。
- **TypeScript 统一 6.0.3，TS 7 延后**：TS 7.0 无 JS 编译器 API，`nest build` 不兼容（见 ADR 0002）；等 TS 7.1 stable + nest-cli 适配后单独立项。
- **Docker Hub 当前网络不可达**：本地镜像从 DaoCloud 公开镜像源拉取后打了标准 tag；换机器需配镜像加速或改 compose 的 image 地址。
- **TanStack Router 目前是 code-based**：要 file-based 再换。
- **shadcn/ui 只装基础依赖**：组件还没铺。
- **Next.js 16 Cache Components 已开启**：未缓存数据必须放在 `<Suspense>` 边界内，`params` promise 传入边界组件后再 await；`await connection()` 单用不够（已踩过）。
- **流式渲染下 404 状态码**：专辑详情页 notFound() 在 Suspense 边界内触发时 HTTP 状态为 200，仅内容为 404 页（PPR 流式固有行为；SEO 影响待 M4 评估）。
- **流式内容依赖客户端脚本**：Cache Components 下 Suspense 内内容经 RSC 流注入，浏览器 JS 未执行时只见 fallback（照片网格、灯箱等均受影响）。关键浏览路径已用原生链接/独立页面兜底（照片详情页）。
- **HEIC 上传未支持**：Q12 要求的 HEIC→JPEG 转换留到后续里程碑；当前仅收 JPEG/PNG/WebP。
- 百度开放平台应用未申请；百度导入未实现。
- 小程序二期未开始。
- 没有测试框架；没有 remote/CI；没有部署。
- 本地测试 admin 密码不写入文档；以 `.env` 的 `ADMIN_PASSWORD` 为准。

### M2-M4（已完成，2026-10-27）

M2 认证 + 内容 CRUD、M3 上传 + 展示纵向切片、M4 后台完整 + 前台完整。详见第 6 节里程碑规划表与对应提交（`ee4c7ce` / `72c865a` / `904b33b`）。

### M4 后体验增强（已完成，2026-10-28，提交 `b121caf`..`e88b790`）

后台（`b121caf` / `ddbcabc` / `ac3c5a8`）：

- 专辑"二维码"弹窗：公开链接 + `/s/:shareToken` 分享链接双码，前端 `qrcode` 库生成，可复制链接（含非安全上下文 `execCommand` 降级）、下载 512px PNG；URL 为可点击链接（新标签打开）
- "手机管理"入口：顶部导航弹出后台地址二维码；Vite `host: true` 暴露局域网
- 域名解析：`VITE_PUBLIC_BASE_URL` / `VITE_PUBLIC_ADMIN_BASE_URL`（admin 端 `envDir` 读根 `.env`），未设置时回退 `http://{当前hostname}:{3000|5173}`
- sonner toast：全部内容操作成功/失败提示（失败保留行内红字）
- 后台照片灯箱：点击缩略图看 LARGE 大图，键盘/按钮翻页
- lucide 图标全站铺开；手机端适配（操作按钮小屏常显、内边距/导航响应式）

前台（`63e9b03` / `ac3c5a8` / `e88b790`）：

- **媒体 URL 相对化**：`CDN_BASE_URL` 默认 `/media`，web 用 next rewrites、admin 用 Vite proxy 同源代理——手机/局域网访问图片正常；生产（M6）配 CDN 绝对地址
- 照片详情页 `/albums/:publicId/photos/:photoPublicId`：服务端渲染大图 + 上一张/下一张（循环）+ EXIF，独立 OG 卡片
- 缩略图为原生链接指向照片页（客户端 JS 失效时仍可整页跳转浏览），JS 正常时拦截为灯箱（键盘/按钮翻页）
- 专辑页"复制链接"分享按钮 + toast；灯箱控制图标化

### M5 百度网盘导入（代码完成，2026-10-28；待真实凭证端到端验收）

- **OAuth**：`GET /api/admin/baidu/authorize`（state 存 session 防 CSRF）→ callback 换 token → uinfo 冒烟 → `BaiduCredential` 单行落库（AES-256-GCM 加密，`APP_ENCRYPTION_KEY`）；懒刷新（距过期 <24h 或 -6/111 时刷新重试一次，in-flight 去重）
- **浏览**：`GET /api/admin/baidu/files` 代理 `xpan/file?method=list`（`web=1` 缩略图、分页 100），浏览根限定 `/apps`（2026-06 后应用的目录权限边界）
- **导入**：`POST /api/admin/imports/baidu`——文件夹在创建任务时同步递归展开（图片过滤 category===3 + 扩展名白名单，单任务 ≤500 张超限报错）；BullMQ 队列 `import`（processor 在 API 进程内，concurrency 2，`ImportModule` 自包含可拆独立 worker）；逐条 filemetas 取 dlink → 下载（固定 `User-Agent: pan.baidu.com`）→ 复用 `PhotoService.createPhotoFromBuffer`（本地上传与导入共用：sha256 去重→SKIPPED、三档 WebP、EXIF）
- **进度/重试**：条目计数实时写回 job；`GET /admin/imports/:jobId` + 专辑横幅 2s 轮询（终态停止）；`POST /admin/imports/:jobId/retry` 重置 FAILED→PENDING 重新入队；job 终态按条目派生（全成 SUCCEEDED / 混合 PARTIAL / 全败 FAILED）；中断恢复：中间态条目重置 PENDING 续跑
- **后台 UI**：专辑页「从网盘导入」弹窗（连接状态、面包屑浏览、多选、分页）+ 进度横幅（进度条、失败项展开、重试按钮）
- 已验证（无凭证）：`/status` 优雅降级、未连接 400/409、本地上传回归（409 去重、三档图、EXIF 不变）、lint/typecheck/build 全绿
- **凭证到位后的验收步骤**：`.env` 填 `BAIDU_APP_KEY/SECRET` + 控制台配 redirect_uri → 弹窗授权 → 照片放入 `/我的应用数据/{应用名}/` → 选文件夹导入；中途 `docker compose stop redis` 再恢复，重试后任务完成（M5 完成标志）
- 注意：运行 `biome check --write --unsafe` 会把 NestJS DI 构造器参数的 import 转成 type-only 导致启动失败，禁止使用（见各 service 里的 `biome-ignore lint/style/useImportType` 注释惯例）

### M5.5 网盘双向同步（已完成并端到端验收，2026-10-29）

决策见 `docs/adr/0002-baidu-netdisk-bidirectional-sync.md`（发布库是唯一权威存储，网盘为热备份镜像）：

- **上行推送**：本地上传成功后自动入队 `netdisk-sync` 队列 push 任务（concurrency 2）；三阶段上传 precreate（分片 MD5 + 秒传探测）→ superfile2（4MB 分片，locateupload 现取主机）→ create，rtype=3；成功回写 `Photo.netdiskFsId/netdiskPath`
- **存量回填**：设置页「全量推送」把所有未同步照片入队；进度用 syncedCount/totalPhotos 实时算
- **下行扫描**：每日 00:30 repeatable（启动时 upsertJobScheduler 注册，执行时检查 `SiteSetting.netdiskDailyScan` 开关）+ 手动「立即检查」；遍历 `/apps/{应用名}/` 全树，fsid 对比 `Photo.netdiskFsId`：新文件夹自动建专辑（仅链接可见）并分批（≤500/任务）走 import 队列自动导入（成功回写 fsid）；网盘侧缺失仅写报告（`SiteSetting.netdiskScanReport`），站内永不动
- **改名/移动传播**：专辑重命名 → filemanager rename 目录；照片换专辑 → filemanager move（均异步可重试，目录不存在视为跳过）
- **删除不自动传播**：站内删除（单张/批量/删专辑）→ 已镜像照片写 `NetdiskPendingDelete`（幂等）；设置页「待确认删除」列表确认后 filemanager delete（-9 视为已达成）或保留
- **应用目录**：`BAIDU_APP_NAME`（可选 env）指定 `/apps/{应用名}`；部分账号不能列 `/apps` 虚拟根（errno -9），配置后浏览根/扫描根直接定位应用目录
- **后台 UI**：设置页「百度网盘镜像同步」卡片（连接状态、开关、立即检查、全量推送、扫描报告、待确认删除）
- 已验证（2026-10-29，真实网盘端到端）：扫描报告 DONE（resolveAppDir 定位应用目录成功）；上传照片 2s 内自动推送、网盘可见（fsid/path 回写）；专辑改名 → 网盘目录重命名；照片换专辑 → filemanager move 传播；删除 → 待确认 → 确认后网盘文件消失；遗留探针文件已清理
- 调试中确认的百度接口契约（均已固化进 `BaiduApiService`）：xpan/file 的 POST 接口（precreate/create/filemanager）query 只放 method+access_token（filemanager 另加 opera），其余参数放 form body，须整体 URL 编码（原样 JSON 报 errno 2）；precreate 必带 autoinit=1；locateupload 需 access_token/path/uploadid/upload_version=2.0，响应字段是 error_code 而非 errno；superfile2 成功响应无 errno（只有 md5），失败用 error_code；filemanager delete 的 filelist 是纯路径字符串数组，move 的 dest 放在条目内，rename 用 async=1 同步取逐文件结果（info[].errno=-9 = 目录从未推送过）

### M5.6 网盘浏览页（已实现，2026-10-29）

后台新页面 `/netdisk`（顶部导航「网盘」入口），树形查看百度网盘文件目录。设计决策（grilling 确认）：

- **只读**：不在页面上操作网盘侧文件（删除/改名一律走站内既有流程，保护镜像一致性——站内是唯一权威存储，见 ADR 0002）
- **文件树**：懒加载（百度 list 只能逐层列）——初始只展示应用根一层，点开文件夹才拉子级，已展开内容前端缓存；单文件夹超 100 条节点内「加载更多」（复用 `GET /admin/baidu/files` 分页）
- **站内对照标注**：图片按 fsid 对照 `Photo.netdiskFsId` 标「已导入/未导入」；文件夹按目录名（sanitize 后）对照专辑标题标对应专辑名或「未对应」
- **缩略图与预览**：图片行显示百度缩略图（现有 API 已带），点击灯箱放大（低清、有 8h 时效，加载失败显示占位图标）
- **导入操作**（站内方向，修复而非破坏镜像）：图片文件勾选多选 → 选目标专辑 → 复用 `POST /admin/imports/baidu`（进度横幅同款）；文件夹行「导入此文件夹」按钮 → 后端递归展开（≤500 张）

实现要点：树状态以 `Record<dir, NodeState>` 前端缓存（闭包式 `renderRow` 递归渲染）；对照数据来自新端点 `GET /admin/netdisk/synced-fsids` + 专辑列表（目录名经 `sanitizeNetdiskName` 归一匹配）；缩略图加载失败降级为占位图标；未连接网盘时引导至站点设置。已对真实网盘完成 API 级验收（根目录列表、子目录图片 fsid 对照、缩略图可用）。

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

里程碑 1、M2、M3、M4 已完成（2026-10-27）。原"里程碑 2"过大，已拆分为 M2-M6，按"尽快打通上传→展示纵向切片"排序：

| 里程碑                            | 内容                                                                                                            | 完成标志                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **M2 认证 + 内容 CRUD** ✅        | 登录/me/改密、专辑/照片/标签/精选/站点设置 CRUD、`publicId`/`shareToken`/`visibility`、排序/批量移动/删除、封面 | Swagger 里能 curl 全套接口，seed 出可见数据 |
| **M3 上传 + 展示（纵向切片）** ✅ | 最小本地上传（原件 + 三档 WebP + EXIF）→ 最小前台（专辑详情 + 灯箱）                                            | 从后台上传一张照片，前台能打开看到          |
| **M4 后台完整 + 前台完整** ✅     | 排序/批量操作/封面/精选排序、首页/列表页/关于/联系页/SEO/OG、`/s/:shareToken`                                   | 站点达到"能用版本"                          |
| **M4.5 体验增强** ✅              | 专辑/手机管理二维码、媒体相对 URL、照片详情页、toast、灯箱、lucide 图标、手机端适配（2026-10-28）               | 手机扫码全流程可用                          |
| **M5 百度网盘导入**               | OAuth、目录浏览、BullMQ job、进度/重试                                                                          | 从网盘导入一个文件夹成功，失败可重试        |
| **M6 部署上线**                   | Caddy、生产 Compose、COS/CDN、ICP、备份、监控、GitHub remote + CI                                               | jiangliuer.com 可访问                       |
| **M7 小程序**（二期）             | Taro 只读浏览                                                                                                   | —                                           |

排序理由：M3 的纵向切片尽早暴露高风险项（Sharp 三档图、`StorageService`、Cache Components）；百度导入（M5）复用同一套上传流水线；ICP 备案周期 1-3 周，可与 M3-M5 并行启动。

### 立即行动（不等里程碑开始）

- ~~现在就申请百度开放平台应用（审批周期不可控，M5 的硬前置）~~ → 已调研（2026-10-28）：选「个人使用」应用**免上线审核**，个人实名认证（身份证号 + 邮箱 + 手机号）立即通过，见下节要点。
- 域名/ICP 备案、腾讯云账号确认可与服务端开发并行推进。

### M5 前置：百度网盘开放平台申请要点（2026-10-28 官方文档调研）

申请步骤（几分钟内可完成）：

1. 注册/登录百度账号 → 官网 `pan.baidu.com/union` 登录
2. 个人实名认证：身份证号 + 邮箱 + 手机号，立即通过；权益 = 1 个应用 + 文件上传/下载/管理能力
3. 控制台创建应用：**用途选「个人使用」（免审核，创建即上线，限 10 用户——单管理员无影响）**，类型选「软件」（不可改），名称 ≤12 字（会展示在授权页和网盘目录里），描述 ≥30 字
4. 记录 AppId / AppKey / SecretKey / SignKey（存 `.env`，对应 `BaiduCredential` 表设计）
5. 应用详情 → 安全设置配置 redirect_uri（dev 配 localhost 回调，生产配 jiangliuer.com）

OAuth 要点（M5 实现用）：

- 授权码模式（有 server 端）；`scope` 固定传 `basic,netdisk`
- `code` 10 分钟有效、一次性；换 `access_token` 后，**`refresh_token` 有效期 10 年**——授权一次存库，后续刷新即可
- 官方文档：`pan.baidu.com/union/doc` 下《接入流程》《创建应用》《权限与配额》

两个关键约束（影响 M5 设计）：

- **目录权限（2026-06-03 后创建的应用）**：download / listall / filemanager / precreate / meta / move 接口只能访问 `/apps/{应用名}/` 目录（用户网盘里显示为 `/我的应用数据/{应用名}/`）。照片母版必须放入该目录才能被 API 导入——发布库整体迁入此目录管理。
- 未审核应用限流 10 次/小时 + 10 用户；「个人使用」应用不适用（创建即已上线），但若误选「公开发布」则审核前按此限制。

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
4. 没有 `.env` 时 `cp .env.example .env`，填好 secrets；手机扫码预览需核对 `VITE_PUBLIC_BASE_URL` / `VITE_PUBLIC_ADMIN_BASE_URL` 里的局域网 IP（`ipconfig getifaddr en0` 查询，IP 变了要同步改）。
5. `bun run db:up`，然后 `bun run dev`。
6. 验证 `/api/health`、`/api/docs`、`/admin/`。
7. 从里程碑 5 继续。
