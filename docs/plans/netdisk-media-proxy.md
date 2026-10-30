# 计划：公开预览改为「百度网盘为源 + 磁盘缓存」媒体代理层

> 2026-10-30 规划讨论结论。背景分支 `feat/vercel-railway-deploy`（Vercel + Railway 部署方案）。

## Context

当前架构（ADR 0001/0002）：站内存储（本地 / 未来 COS）是唯一权威存储与图床，网盘只做热备份镜像（只推原件）。现部署方案为 Vercel（web/admin）+ Railway（API），希望**公开 web 预览的图片全部改为从百度网盘取**，动机是省去 COS/CDN 成本。

已确认的约束：

- **速度不能盲目接受——先实测网盘下载速度，太慢就退回 COS/CDN**（验证门）。
- 图片来源范围：THUMB(400) 走百度缩略图接口；DISPLAY(1600)/LARGE(2560) 从网盘原件取。
- 本地上传流程不变（原件 + 三档 rendition 仍生成存站内，网盘推送照旧）。

关键事实（已核实）：

- `/media` 由 Express static 挂载（`apps/api/src/main.ts:62`），无代理层；URL scheme `/media/photos/{publicId}/{thumb|display|large}.webp`，key 可反解出 publicId+variant，**无需新增 Prisma 字段**。
- `BaiduApiService.download`（`apps/api/src/baidu/baidu-api.service.ts:250-262`）整体 buffer 进内存、无流式；**没有缩略图接口**（admin /netdisk 页用的是 `list` 返回的 `thumbs.url3` 直链，8h 时效）。
- 网盘只推原件（`netdisk-sync.service.ts:317`）；**dlink 拉回的是原件 jpg/png，不是 rendition**——直接回传会导致字节量/尺寸与 PhotoRendition 元数据严重不符，必须 sharp 现场生成。
- web/admin 用 API 返回的 `url` 字段渲染 `<img>`，前端零改动可达。

## Phase -1：建分支并保存讨论 ✅

分支 `feat/netdisk-media-proxy`（自 `feat/vercel-railway-deploy`）；本文档即讨论存档。

## Phase 0：验证门（先做，产出决定走哪条路）

### 0.1 缩略图接口调研

查官方文档 pan.baidu.com/union/doc 缩略图接口（候选 `rest/2.0/xpan/thumbnail?method=get`，**参数以文档为准**）：确认 size 档位（有无 ≥400px）、是否仅图片类目有效、QPS 限制、是否与 list/filemetas 共用配额；对照评估 `list` 的 `thumbs.url3` 直链（分辨率、防盗链、8h 时效）。

### 0.2 吞吐实测（`scripts/spike-netdisk-throughput.ts`，一次性脚本）

1. 本地 dev 连接网盘后，脚本用 `crypto.util.ts` 的 `decryptAes256Gcm` + `APP_ENCRYPTION_KEY` 解密 DB 中 `BaiduCredential.accessToken`（只读 DB）。
2. `filemetas` 取已同步照片原件 dlink → 分段计时下载，记录 MB/s。
3. 缩略图接口计首字节/总延迟、返回分辨率。
4. **两个网络侧各测一遍**：本机 + Railway 容器内（Baidu→Railway 一段决定首载延迟；Railway 无 exec，临时部署跑脚本的服务或改启动参数跑一次回滚）。

### 0.3 判定标准（建议值，可调）

| 指标 | 继续网盘方案 | 回退 COS/CDN |
|---|---|---|
| Railway 容器内拉原件吞吐 | ≥ 2 MB/s（2560 首载含 sharp ≤ 8s） | < 1 MB/s 或频繁限速 |
| 缩略图接口首载 | ≤ 1.5s 且有 ≥400px 档 | 无合适档 / >3s / 成片 -70 限流 |
| 稳定性 | 连续 50 次无批量失败 | 成片限流或 token 异常 |

产出 `docs/adr/0003-netdisk-as-media-source.md` 记录数据与结论；不达标则只写 ADR + 走回退设计，不动代码。

## Phase 1：实现（验证门通过后）

### 1.1 BaiduApiService 扩展（`apps/api/src/baidu/baidu-api.service.ts`）

- `thumbnail(accessToken, path, size): Promise<Response>`：返回原始 Response，错误按现有类型化错误（`BaiduAuthError`/`BaiduRateLimitError`/`BaiduApiError`）。
- `downloadStream(dlink, accessToken)`：与现有 `download` 相同的 URL 拼接 + 固定 UA（`pan.baidu.com`），但**不读 body**，返回 `{ body: ReadableStream; contentType; contentLength }`。保留旧 `download`（import 流程仍用）。
- token 刷新重试仍由 `BaiduCredentialService.withAccessToken` 包「取流」一步（幂等成立），不包转发过程。

### 1.2 新建媒体代理模块 `apps/api/src/media/`

- **`media-proxy.service.ts`**（核心）`handle(req, res, key)`：
  1. 缓存命中 → `createReadStream` + `Cache-Control: public, max-age=31536000, immutable`；Content-Type 按缓存记录的实际 mime（缩略图接口回 JPEG，不是 webp）。
  2. miss → 按 key 解析 publicId+variant 查库（`netdiskFsId`、album title）；照片不存在 → 404。
  3. THUMB：`netdiskFsId` 非空 → 拼 `/apps/{应用名}/...` 路径（复用 `netdisk-paths.ts` 的 `netdiskFilename` / `netdisk-sync.service.ts` 的 `resolveAppDir`，路径约定必须一致）→ 缩略图接口 → 流式 tee 到响应 + 缓存临时文件（rename 原子落位）。
  4. DISPLAY/LARGE：`filemetas` 取 dlink → `downloadStream` **先落盘** → 读回 → 复用 `PhotoProcessingService.generateRenditions` 现场生成 → 回传对应 variant 并落缓存（原件 ≤50MB 由 `MAX_UPLOAD_BYTES` 保证，内存峰值可控）。
  5. **回退**：任一网盘失败（未连接 / fsId 为 null / 限流 / 异常）→ 站内本地 rendition 文件流式回传（本地上传文件仍在）；都没有 → 404。失败 `logger.warn` 同 key 限频。
  - **single-flight**：`Map<key, Promise>` 去重并发 miss（画廊首访必然并发几十张）；sharp 处理加简单信号量防 OOM。
  - 缓存根 `MEDIA_CACHE_DIR`（默认 `var/media-cache`，Railway 配 `/data/media-cache`）——**与 STORAGE_DIR 分离**，绝不能用网盘字节覆盖本地 rendition key（删除流程按 key unlink，混写会误删）。
- **`media-cache.ts`**：缓存路径/临时文件/原子 rename 纯函数工具（不进 StorageService——它是上传存储抽象，混入会让 COS 回退复杂化）。
- **`media-proxy.module.ts`**：import BaiduModule / PrismaModule / StorageModule / PhotoModule（`BaiduApiService`、`PhotoProcessingService` 若未 export 则补）。
- 挂载：`main.ts` 在 `useStaticAssets`（:62）**之前**插 Express 中间件，仅拦截 `/media/photos/` 前缀，其余放行给 static（settings 二维码等不受影响）；DI 在 `NestFactory.create` 之后 `app.get(MediaProxyService)`。

### 1.3 配置（`apps/api/src/config/env.ts`，全带默认值）

- `MEDIA_CACHE_DIR`（默认 `var/media-cache`）
- `MEDIA_NETDISK_SOURCE`（`netdisk | local`，默认 `netdisk`；**一键回退保险丝**，改 env 不发版）
- `MEDIA_THUMB_BAIDU_SIZE`（Phase 0 结论值；置空则 THUMB 也走原件+sharp 统一路径）

### 1.4 零改动清单（确认不动）

- Prisma schema（无迁移）、`publicUrl` 及全部调用方、apps/web（含 next.config rewrite）、apps/admin、netdisk-sync、本地上传流程。

## 验证方式

**本地**（`MEDIA_CACHE_DIR` 指临时目录）：

1. 上传新照片 → 网盘推送成功（fsId 非空）→ `curl -I :3001/media/photos/{id}/thumb.webp` 200 + immutable 头 + 缓存文件出现；返回字节数与 rendition 同量级（非原件）。
2. 二次请求无网盘调用、<50ms；清缓存后并发 30 同 key → 网盘只调一次（single-flight）；并发 30 不同 key → 全 200 无 OOM。
3. 回退：解绑网盘（或 fsId 为 null 的老照片）清缓存再访 → 仍 200（本地文件）。

**部署**：Railway 配 `MEDIA_CACHE_DIR=/data/media-cache`，清 Volume 缓存后访问画廊；重点观测 Vercel rewrite 对慢上游的超时（生产 `CDN_BASE_URL` 为 API 绝对地址时 web 直连 API、不经 Vercel 代理，可作缓解）；Railway Metrics 看 egress 与内存。

## 回退设计

- 代理层结构全部保留，miss 源封装为可替换方法；失败回退 = 新增 `CosMediaSource`（env 已预留 COS_* 变量），改动收敛在 `apps/api/src/media/` 一个目录。
- 只缩略图不合格：`MEDIA_THUMB_BAIDU_SIZE` 置空，THUMB 统一走原件+sharp 路径。
- 彻底回退：`MEDIA_NETDISK_SOURCE=local` 等价现状，仅改 env。本地 rendition 文件从未删除，无数据迁移。

## 风险清单

| 风险 | 应对 |
|---|---|
| dlink 限速（非 SVIP 常态，可能 100KB/s 级） | Phase 0 硬门，回退零成本 |
| 回传原件尺寸/字节不符 | miss 时 sharp 现场生成 rendition |
| OOM（50MB 原件 × 并发 miss） | single-flight + 落盘再读回 + sharp 信号量 |
| token 在长下载中途过期 | token 只用于发起请求，重试只包取流一步 |
| 百度 QPS 配额（-70/-12） | 缓存为主防御；限流直接走本地回退 + warn |
| Vercel rewrite 慢上游超时 | 验收观测；生产绝对 URL 直连 API 绕过 |
| Railway egress 费用 | 缓存只省百度侧不省 egress；deploy.md 量化（约 100k 张 × 200KB ≈ 20GB/月）；后备：THUMB 302 到百度 CDN 直链（零 egress，但防盗链/8h 脆弱） |
| 缓存目录无限增长 | v1 手工清理，预留 `MEDIA_CACHE_MAX_BYTES` |

## 文件清单

**新建**：`apps/api/src/media/{media-proxy.service,media-proxy.module,media-cache}.ts`（+中间件或并入 service）、`scripts/spike-netdisk-throughput.ts`（可不入库）、`docs/adr/0003-netdisk-as-media-source.md`

**修改**：`apps/api/src/baidu/baidu-api.service.ts`、`apps/api/src/main.ts`、`apps/api/src/app.module.ts`、`apps/api/src/config/env.ts`、`apps/api/src/photo/photo.module.ts` 与 `baidu/baidu.module.ts`（补 export，若缺）、`docs/deploy.md`

**规约**：api 侧相对导入写 `.js` 后缀；NestJS DI 构造参数运行时 import + `biome-ignore lint/style/useImportType`；禁 `biome --unsafe`；只用 bun。
