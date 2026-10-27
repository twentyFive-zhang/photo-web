import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import {
  adminSchema,
  albumSchema,
  apiHealthSchema,
  changePasswordInputSchema,
  createAlbumInputSchema,
  featuredItemSchema,
  loginInputSchema,
  photoSchema,
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
