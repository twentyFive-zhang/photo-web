import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import {
  adminSchema,
  albumSchema,
  apiHealthSchema,
  baiduConnectionStatusSchema,
  baiduDirectoryListingSchema,
  changePasswordInputSchema,
  createAlbumInputSchema,
  createBaiduImportInputSchema,
  featuredItemSchema,
  importJobSchema,
  loginInputSchema,
  netdiskScanTriggeredSchema,
  netdiskStatusSchema,
  photoSchema,
  publicAlbumSchema,
  publicAlbumSummarySchema,
  publicFeaturedPhotoSchema,
  publicSiteSettingSchema,
  reorderPhotosInputSchema,
  setFeaturedInputSchema,
  setPhotoTagsInputSchema,
  siteSettingSchema,
  tagSchema,
  updateAlbumInputSchema,
  updatePhotoInputSchema,
  updateSiteSettingInputSchema,
} from "@photo/shared";
import { z } from "zod";

type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

/** 生成 M2 全部路由的 OpenAPI 3.1 文档。 */
export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  const healthSchema = apiHealthSchema.meta({ id: "ApiHealth" });
  const admin = adminSchema.meta({ id: "Admin" });
  const album = albumSchema.meta({ id: "Album" });
  const photo = photoSchema.meta({ id: "Photo" });
  const tag = tagSchema.meta({ id: "Tag" });
  const featuredItem = featuredItemSchema.meta({ id: "FeaturedItem" });
  const siteSetting = siteSettingSchema.meta({ id: "SiteSetting" });
  const publicAlbumSummary = publicAlbumSummarySchema.meta({
    id: "PublicAlbumSummary",
  });
  const publicAlbum = publicAlbumSchema.meta({ id: "PublicAlbum" });
  const publicFeaturedPhoto = publicFeaturedPhotoSchema.meta({
    id: "PublicFeaturedPhoto",
  });
  const publicSiteSetting = publicSiteSettingSchema.meta({
    id: "PublicSiteSetting",
  });

  registry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "photo.sid",
    description: "管理员 session cookie（POST /api/auth/login 获取）",
  });

  const json = (schema: unknown) => ({
    "application/json": { schema: schema as never },
  });
  const ok = (schema: unknown, description: string) => ({
    200: { description, content: json(schema) },
  });
  const noContent = (description = "成功") => ({
    204: { description },
  });
  const security = [{ sessionCookie: [] }];

  // ---------- system ----------
  registry.registerPath({
    method: "get",
    path: "/api/health",
    summary: "健康检查",
    tags: ["system"],
    responses: ok(healthSchema, "API 正常"),
  });

  // ---------- auth ----------
  registry.registerPath({
    method: "post",
    path: "/api/auth/login",
    summary: "管理员登录（限流：每 IP 每分钟 10 次）",
    tags: ["auth"],
    request: { body: { content: json(loginInputSchema) } },
    responses: {
      ...ok(admin, "登录成功，设置 session cookie"),
      401: { description: "用户名或密码错误" },
      429: { description: "触发限流" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/auth/logout",
    summary: "登出",
    tags: ["auth"],
    security,
    responses: noContent(),
  });
  registry.registerPath({
    method: "get",
    path: "/api/auth/me",
    summary: "当前登录管理员",
    tags: ["auth"],
    security,
    responses: { ...ok(admin, "当前管理员"), 401: { description: "未登录" } },
  });
  registry.registerPath({
    method: "patch",
    path: "/api/auth/password",
    summary: "修改密码",
    tags: ["auth"],
    security,
    request: { body: { content: json(changePasswordInputSchema) } },
    responses: { ...noContent(), 401: { description: "当前密码错误" } },
  });

  // ---------- albums ----------
  registry.registerPath({
    method: "get",
    path: "/api/admin/albums",
    summary: "专辑列表（含生效封面与照片数）",
    tags: ["albums"],
    security,
    responses: ok(z.array(album), "专辑列表"),
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/albums",
    summary: "创建专辑（默认仅链接可见）",
    tags: ["albums"],
    security,
    request: { body: { content: json(createAlbumInputSchema) } },
    responses: ok(album, "已创建"),
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/albums/{id}",
    summary: "专辑详情",
    tags: ["albums"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok(album, "专辑"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "patch",
    path: "/api/admin/albums/{id}",
    summary: "更新专辑（visibility/封面/标题/描述；首次公开记录 publishedAt）",
    tags: ["albums"],
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: json(updateAlbumInputSchema) },
    },
    responses: { ...ok(album, "已更新"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "delete",
    path: "/api/admin/albums/{id}",
    summary: "删除专辑（级联删除照片）",
    tags: ["albums"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { ...noContent(), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/albums/{id}/share-token",
    summary: "轮换分享 token，旧链接立即失效",
    tags: ["albums"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok(album, "已轮换"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/albums/{id}/photos",
    summary: "专辑内照片（按排序）",
    tags: ["albums"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      ...ok(z.array(photo), "照片列表"),
      404: { description: "不存在" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/albums/{id}/photos/reorder",
    summary: "重排专辑内照片（传入全部照片 id 的目标顺序）",
    tags: ["albums"],
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: json(reorderPhotosInputSchema) },
    },
    responses: { ...noContent(), 404: { description: "不存在或不属于该专辑" } },
  });

  registry.registerPath({
    method: "post",
    path: "/api/admin/albums/{id}/photos/upload",
    summary: "本地上传照片到专辑（multipart，字段 file；JPEG/PNG/WebP ≤50MB）",
    tags: ["albums"],
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "multipart/form-data": {
            schema: z.object({ file: z.string() }),
          },
        },
      },
    },
    responses: {
      ...ok(photo, "已上传的照片"),
      404: { description: "专辑不存在" },
      409: { description: "相同内容的照片已存在" },
      415: { description: "不支持的文件类型或超过大小上限" },
    },
  });

  // ---------- public（访客） ----------
  registry.registerPath({
    method: "get",
    path: "/api/albums",
    summary: "公开专辑列表（按发布时间倒序）",
    tags: ["public"],
    responses: ok(z.array(publicAlbumSummary), "公开专辑列表"),
  });
  registry.registerPath({
    method: "get",
    path: "/api/albums/{publicId}",
    summary: "公开专辑详情（公开与仅链接可见均可访问）",
    tags: ["public"],
    request: { params: z.object({ publicId: z.string() }) },
    responses: {
      ...ok(publicAlbum, "专辑详情（含照片 rendition URL）"),
      404: { description: "不存在" },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/share/{shareToken}",
    summary: "仅链接可见专辑入口（24 位分享 token）",
    tags: ["public"],
    request: { params: z.object({ shareToken: z.string() }) },
    responses: {
      ...ok(publicAlbum, "专辑详情"),
      404: { description: "不存在或链接已失效" },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/featured",
    summary: "公开精选（首页展示，照片可来自任意专辑）",
    tags: ["public"],
    responses: ok(z.array(publicFeaturedPhoto), "精选照片列表"),
  });
  registry.registerPath({
    method: "get",
    path: "/api/settings",
    summary: "公开站点设置（关于/联系/页头页脚）",
    tags: ["public"],
    responses: ok(publicSiteSetting, "站点设置"),
  });

  // ---------- photos ----------
  registry.registerPath({
    method: "get",
    path: "/api/admin/photos/{id}",
    summary: "照片详情（含 renditions 与标签）",
    tags: ["photos"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok(photo, "照片"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "patch",
    path: "/api/admin/photos/{id}",
    summary: "更新照片标题/说明",
    tags: ["photos"],
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: json(updatePhotoInputSchema) },
    },
    responses: { ...ok(photo, "已更新"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "delete",
    path: "/api/admin/photos/{id}",
    summary: "删除照片",
    tags: ["photos"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { ...noContent(), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "put",
    path: "/api/admin/photos/{id}/tags",
    summary: "全量替换照片标签（name 自动规范化：trim/空白合并/小写去重）",
    tags: ["photos"],
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: json(setPhotoTagsInputSchema) },
    },
    responses: { ...ok(photo, "已更新"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/photos/batch-move",
    summary: "批量移动照片到目标专辑",
    tags: ["photos"],
    security,
    request: {
      body: {
        content: json(
          z.object({
            photoIds: z.array(z.string()),
            targetAlbumId: z.string(),
          }),
        ),
      },
    },
    responses: ok(z.object({ moved: z.number() }), "移动数量"),
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/photos/batch-delete",
    summary: "批量删除照片",
    tags: ["photos"],
    security,
    request: {
      body: { content: json(z.object({ photoIds: z.array(z.string()) })) },
    },
    responses: ok(z.object({ deleted: z.number() }), "删除数量"),
  });

  // ---------- tags ----------
  registry.registerPath({
    method: "get",
    path: "/api/admin/tags",
    summary: "标签列表（按照片数降序）",
    tags: ["tags"],
    security,
    responses: ok(z.array(tag), "标签列表"),
  });
  registry.registerPath({
    method: "delete",
    path: "/api/admin/tags/{id}",
    summary: "删除标签（自动从所有照片摘除）",
    tags: ["tags"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { ...noContent(), 404: { description: "不存在" } },
  });

  // ---------- featured ----------
  registry.registerPath({
    method: "get",
    path: "/api/admin/featured",
    summary: "精选列表（人工排序）",
    tags: ["featured"],
    security,
    responses: ok(z.array(featuredItem), "精选列表"),
  });
  registry.registerPath({
    method: "put",
    path: "/api/admin/featured",
    summary: "全量替换精选列表（空数组 = 清空）",
    tags: ["featured"],
    security,
    request: { body: { content: json(setFeaturedInputSchema) } },
    responses: ok(z.array(featuredItem), "替换后的精选列表"),
  });
  registry.registerPath({
    method: "delete",
    path: "/api/admin/featured/{photoId}",
    summary: "从精选移除一张照片",
    tags: ["featured"],
    security,
    request: { params: z.object({ photoId: z.string() }) },
    responses: { ...noContent(), 404: { description: "不在精选中" } },
  });

  // ---------- settings ----------
  registry.registerPath({
    method: "get",
    path: "/api/admin/settings",
    summary: "站点设置（单例，自动初始化）",
    tags: ["settings"],
    security,
    responses: ok(siteSetting, "站点设置"),
  });
  registry.registerPath({
    method: "put",
    path: "/api/admin/settings",
    summary: "更新站点设置（部分更新；contactEmail 空串视为清除）",
    tags: ["settings"],
    security,
    request: { body: { content: json(updateSiteSettingInputSchema) } },
    responses: ok(siteSetting, "已更新"),
  });

  // ---------- baidu / import（M5 网盘导入） ----------
  const baiduStatus = baiduConnectionStatusSchema.meta({
    id: "BaiduConnectionStatus",
  });
  const baiduListing = baiduDirectoryListingSchema.meta({
    id: "BaiduDirectoryListing",
  });
  const importJob = importJobSchema.meta({ id: "ImportJob" });
  const baiduParams = z.object({
    dir: z.string().optional(),
    page: z.string().optional(),
  });

  registry.registerPath({
    method: "get",
    path: "/api/admin/baidu/status",
    summary: "百度网盘连接状态（不含 token 本体）",
    tags: ["baidu"],
    security,
    responses: ok(baiduStatus, "连接状态"),
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/baidu/authorize",
    summary: "发起百度 OAuth 授权（302 到百度授权页）",
    tags: ["baidu"],
    security,
    responses: {
      302: { description: "跳转百度授权页" },
      400: { description: "未配置百度应用" },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/baidu/callback",
    summary: "OAuth 回调（校验 state → 换 token → 落库 → 跳回后台）",
    tags: ["baidu"],
    request: {
      query: z.object({ code: z.string(), state: z.string() }),
    },
    responses: {
      302: { description: "跳回后台" },
      400: { description: "state 校验失败" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/baidu/disconnect",
    summary: "断开百度网盘授权（删除凭证）",
    tags: ["baidu"],
    security,
    responses: noContent(),
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/baidu/files",
    summary: "浏览网盘目录（分页，根路径限定 /apps）",
    tags: ["baidu"],
    security,
    request: { query: baiduParams },
    responses: {
      ...ok(baiduListing, "目录内容"),
      400: { description: "目录越出 /apps 边界" },
      409: { description: "未连接百度网盘" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/imports/baidu",
    summary:
      "创建网盘导入任务（文件夹同步展开，图片过滤，单任务 ≤500 张；文件夹展开超过上限报错）",
    tags: ["import"],
    security,
    request: { body: { content: json(createBaiduImportInputSchema) } },
    responses: {
      ...ok(importJob, "已创建的导入任务"),
      400: { description: "无可导入图片或超上限" },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/imports/{jobId}",
    summary: "导入任务详情（含条目与失败原因）",
    tags: ["import"],
    security,
    request: { params: z.object({ jobId: z.string() }) },
    responses: { ...ok(importJob, "导入任务"), 404: { description: "不存在" } },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/imports/{jobId}/retry",
    summary: "重试失败条目（重置为 PENDING 后重新入队）",
    tags: ["import"],
    security,
    request: { params: z.object({ jobId: z.string() }) },
    responses: {
      ...ok(importJob, "重试后的任务"),
      400: { description: "没有可重试的失败项" },
      404: { description: "不存在" },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/albums/{albumId}/imports",
    summary: "专辑最近导入任务（进度横幅轮询用）",
    tags: ["import"],
    security,
    request: { params: z.object({ albumId: z.string() }) },
    responses: ok(z.array(importJob), "任务列表"),
  });

  // ---------- netdisk（M5.5 双向同步） ----------
  const netdiskStatus = netdiskStatusSchema.meta({ id: "NetdiskStatus" });
  registry.registerPath({
    method: "get",
    path: "/api/admin/netdisk/status",
    summary: "网盘同步状态（连接、开关、进度、待确认删除、扫描报告）",
    tags: ["netdisk"],
    security,
    responses: ok(netdiskStatus, "同步状态"),
  });
  registry.registerPath({
    method: "get",
    path: "/api/admin/netdisk/synced-fsids",
    summary: "站内已导入照片的网盘 fsid 集合（浏览页对照标注用）",
    tags: ["netdisk"],
    security,
    responses: ok(z.object({ fsids: z.array(z.string()) }), "fsid 列表"),
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/netdisk/scan",
    summary: "手动触发下行扫描（新文件夹自动建专辑并导入，缺失仅报告）",
    tags: ["netdisk"],
    security,
    responses: {
      ...ok(netdiskScanTriggeredSchema, "已入队"),
      400: { description: "未连接百度网盘" },
      409: { description: "扫描正在进行中" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/netdisk/push-all",
    summary:
      "全量推送：所有未同步照片入队上行（增量推送自动进行，此为存量回填）",
    tags: ["netdisk"],
    security,
    responses: {
      ...ok(z.object({ queued: z.number() }), "已入队数量"),
      400: { description: "未连接百度网盘" },
      409: { description: "全量推送正在进行中" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/netdisk/albums/{albumId}/push",
    summary: "按专辑补推：该专辑未同步照片入队上行",
    tags: ["netdisk"],
    security,
    request: { params: z.object({ albumId: z.string() }) },
    responses: {
      ...ok(z.object({ queued: z.number() }), "已入队数量（0 = 无待同步）"),
      400: { description: "未连接百度网盘" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/netdisk/pending-deletes/{id}/confirm",
    summary: "确认删除网盘镜像文件（站内已删；API 删除不可恢复）",
    tags: ["netdisk"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "已删除" },
      404: { description: "不存在" },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/admin/netdisk/pending-deletes/{id}/dismiss",
    summary: "放弃删除网盘镜像文件（保留副本，移除待确认记录）",
    tags: ["netdisk"],
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "已保留" },
      404: { description: "不存在" },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "江流儿摄影 API",
      version: "0.2.0",
      description: "Personal photography portfolio API",
    },
    servers: [{ url: "/" }],
    security: security as never,
  });
}
