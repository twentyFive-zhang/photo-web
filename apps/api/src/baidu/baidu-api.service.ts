import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.js";

/** token 失效（errno -6）或 token 过期（errno 111），应刷新后重试。 */
export class BaiduAuthError extends Error {
  constructor(errno: number) {
    super(`百度授权失效 (errno ${errno})`);
    this.name = "BaiduAuthError";
  }
}

/** 频率/次数超限。 */
export class BaiduRateLimitError extends Error {
  constructor(errno: number) {
    super(`百度接口调用超限 (errno ${errno})`);
    this.name = "BaiduRateLimitError";
  }
}

export class BaiduApiError extends Error {
  constructor(
    message: string,
    readonly errno: number,
  ) {
    super(message);
    this.name = "BaiduApiError";
  }
}

/** 百度 OAuth token 接口返回。 */
export interface BaiduTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** method=list 的条目（原始字段为下划线命名）。 */
export interface BaiduListEntry {
  fs_id: number;
  path: string;
  server_filename: string;
  size: number;
  isdir: number;
  category: number;
  server_mtime: number;
  thumbs?: { url1?: string; url2?: string; url3?: string };
}

export interface BaiduListResponse {
  errno: number;
  list?: BaiduListEntry[];
}

export interface BaiduFilemetaEntry {
  fs_id: number;
  path?: string;
  filename?: string;
  dlink?: string;
}

export interface BaiduFilemetasResponse {
  errno: number;
  list?: BaiduFilemetaEntry[];
}

export interface BaiduUinfoResponse {
  errno: number;
  uk?: number;
  baidu_name?: string;
}

export interface BaiduPrecreateResponse {
  errno: number;
  return_type: number;
  uploadid: string;
  block_list?: number[];
}

export interface BaiduUploadHostResponse {
  /** 此接口（d.pcs.baidu.com）返回 error_code 而非 errno。 */
  error_code?: number;
  host?: string;
}

export interface BaiduCreateResponse {
  errno: number;
  fs_id?: number;
}

/** filemanager 的操作类型。 */
export type BaiduFilemanagerOpera = "delete" | "move" | "rename";

/** filemanager 单个文件条目（delete 时只用 path，整体转成路径字符串数组）。 */
export interface BaiduFilemanagerEntry {
  path: string;
  newname?: string;
  dest?: string;
}

interface BaiduFilemanagerResponse {
  errno: number;
  info?: { errno: number; path?: string }[];
}

const PAN_BASE = "https://pan.baidu.com";
const PCS_BASE = "https://d.pcs.baidu.com";
const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";
/** 分片上传固定 appid（官方文档固定值）。 */
const PCS_APPID = 250528;
/** 普通用户分片大小固定 4MB。 */
export const BAIDU_CHUNK_SIZE = 4 * 1024 * 1024;

/** errno → 类型化错误；调用方据此决定是否刷新 token / 重试。 */
function assertOk(errno: number, context: string): void {
  if (errno === 0) {
    return;
  }
  if (errno === -6 || errno === 111) {
    throw new BaiduAuthError(errno);
  }
  if (errno === 12 || errno === -70) {
    throw new BaiduRateLimitError(errno);
  }
  throw new BaiduApiError(`${context}失败 (errno ${errno})`, errno);
}

/**
 * 百度网盘开放平台薄客户端。所有接口形状只在这里出现，
 * 响应字段以 pan.baidu.com/union/doc 文档为准，出入只改本文件。
 */
@Injectable()
export class BaiduApiService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get appKey(): string {
    return this.config.get("BAIDU_APP_KEY", { infer: true }) ?? "";
  }

  private get appSecret(): string {
    return this.config.get("BAIDU_APP_SECRET", { infer: true }) ?? "";
  }

  private get redirectUri(): string {
    return this.config.get("BAIDU_REDIRECT_URI", { infer: true }) ?? "";
  }

  /** .env 是否配置齐三项百度应用凭证。 */
  isAppConfigured(): boolean {
    return Boolean(this.appKey && this.appSecret && this.redirectUri);
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.appKey,
      redirect_uri: this.redirectUri,
      scope: "basic,netdisk",
      display: "page",
      state,
    });
    return `https://openapi.baidu.com/oauth/2.0/authorize?${params.toString()}`;
  }

  async exchangeToken(code: string): Promise<BaiduTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.appKey,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
    });
    return this.tokenRequest(params, "换取 access_token");
  }

  async refreshToken(refreshToken: string): Promise<BaiduTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.appKey,
      client_secret: this.appSecret,
    });
    return this.tokenRequest(params, "刷新 access_token");
  }

  /** 用 uinfo 冒烟验证 token 可用（顺带拿 uk，当前不持久化）。 */
  async uinfo(accessToken: string): Promise<BaiduUinfoResponse> {
    const params = new URLSearchParams({
      method: "uinfo",
      access_token: accessToken,
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/nas?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduUinfoResponse;
    assertOk(data.errno, "获取用户信息");
    return data;
  }

  /**
   * 列目录。dir 必须以 /apps 开头（2026-06 后创建应用的目录权限边界）。
   * web=1 返回缩略图；page/num 分页（num 上限 1000，这里取 100）。
   */
  async list(
    accessToken: string,
    dir: string,
    page: number,
  ): Promise<BaiduListResponse> {
    const params = new URLSearchParams({
      method: "list",
      access_token: accessToken,
      dir,
      web: "1",
      page: String(page),
      num: "100",
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/file?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduListResponse;
    assertOk(data.errno, "列出网盘目录");
    return data;
  }

  /** 批量取文件元信息（含 dlink），单次最多 100 个 fsid。 */
  async filemetas(
    accessToken: string,
    fsIds: number[],
  ): Promise<BaiduFilemetaEntry[]> {
    const params = new URLSearchParams({
      method: "filemetas",
      access_token: accessToken,
      fsids: JSON.stringify(fsIds),
      dlink: "1",
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/multimedia?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduFilemetasResponse;
    assertOk(data.errno, "查询文件元信息");
    return data.list ?? [];
  }

  /**
   * 下载 dlink 指向的文件内容。要求固定 User-Agent，
   * dlink 有时效且不可落库——每条目下载前现取。
   */
  async download(dlink: string, accessToken: string): Promise<Buffer> {
    const url = `${dlink}${dlink.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "pan.baidu.com" },
    });
    if (!response.ok) {
      throw new BaiduApiError(
        `下载文件失败 (HTTP ${response.status})`,
        response.status,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * 上传前置：取分片上传主机（约 60s 时效，每次上传前现取）。
   * 必须带 access_token/path/uploadid/upload_version=2.0（官方文档要求）。
   */
  async locateupload(
    accessToken: string,
    path: string,
    uploadid: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      method: "locateupload",
      appid: String(PCS_APPID),
      access_token: accessToken,
      path,
      uploadid,
      upload_version: "2.0",
    });
    const response = await fetch(
      `${PCS_BASE}/rest/2.0/pcs/file?${params.toString()}`,
    );
    const data = (await response.json()) as BaiduUploadHostResponse;
    if ((data.error_code ?? 0) !== 0 || !data.host) {
      throw new BaiduApiError(
        `获取上传主机失败 (error_code ${data.error_code})`,
        data.error_code ?? -1,
      );
    }
    return data.host;
  }

  /**
   * xpan/file 的 POST 请求统一形态（实测验证）：
   * query 只放 method + access_token，其余参数放 form body
   * （application/x-www-form-urlencoded，URLSearchParams 自动设置）；
   * 全放 query 会报 errno 2。
   */
  private async postForm(
    query: URLSearchParams,
    body: URLSearchParams,
    context: string,
  ): Promise<Response> {
    return fetch(`${PAN_BASE}/rest/2.0/xpan/file?${query.toString()}`, {
      method: "POST",
      body,
    });
  }

  /**
   * 上传第一阶段：precreate 校验分片，返回 uploadid。
   * contentMd5/sliceMd5 用于秒传探测（无文档承诺，失败也只是多传一遍）。
   * rtype=3：同名同路径时覆盖；autoinit=1 必带（缺了 errno 0 但不返回 uploadid）。
   */
  async precreate(
    accessToken: string,
    input: {
      path: string;
      size: number;
      blockList: string[];
      contentMd5: string;
      sliceMd5: string;
    },
  ): Promise<BaiduPrecreateResponse> {
    const query = new URLSearchParams({
      method: "precreate",
      access_token: accessToken,
    });
    const body = new URLSearchParams({
      path: input.path,
      size: String(input.size),
      isdir: "0",
      autoinit: "1",
      block_list: JSON.stringify(input.blockList),
      "content-md5": input.contentMd5,
      "slice-md5": input.sliceMd5,
      rtype: "3",
    });
    const response = await this.postForm(query, body, "上传预创建");
    const data = (await response.json()) as BaiduPrecreateResponse;
    assertOk(data.errno, "上传预创建");
    return data;
  }

  /** 上传第二阶段：单片上传（4MB），partseq 从 0 开始。 */
  async superfile2(
    accessToken: string,
    input: {
      host: string;
      path: string;
      uploadid: string;
      partseq: number;
      chunk: Buffer;
    },
  ): Promise<void> {
    const params = new URLSearchParams({
      method: "upload",
      access_token: accessToken,
      type: "object",
      path: input.path,
      uploadid: input.uploadid,
      partseq: String(input.partseq),
    });
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.chunk)]),
      `blob-${input.partseq}`,
    );
    const response = await fetch(
      `https://${input.host}/rest/2.0/pcs/superfile2?${params.toString()}`,
      { method: "POST", body: form },
    );
    // pcs 域名成功响应无 errno（只有 md5）；失败用 error_code（pcs）或 errno（xpan）
    const data = (await response.json()) as {
      errno?: number;
      error_code?: number;
    };
    assertOk(data.error_code ?? data.errno ?? 0, "上传分片");
  }

  /** 上传第三阶段：create 提交合并，返回 fs_id。 */
  async create(
    accessToken: string,
    input: {
      path: string;
      size: number;
      uploadid: string;
      blockList: string[];
    },
  ): Promise<number> {
    const query = new URLSearchParams({
      method: "create",
      access_token: accessToken,
    });
    const body = new URLSearchParams({
      path: input.path,
      size: String(input.size),
      isdir: "0",
      block_list: JSON.stringify(input.blockList),
      uploadid: input.uploadid,
      rtype: "3",
    });
    const response = await this.postForm(query, body, "提交上传");
    const data = (await response.json()) as BaiduCreateResponse;
    assertOk(data.errno, "提交上传");
    if (!data.fs_id) {
      throw new BaiduApiError("提交上传未返回 fs_id", data.errno);
    }
    return data.fs_id;
  }

  /**
   * 文件管理（move/rename/delete），POST form body（实测验证）：
   * query 放 method+access_token+opera，body 放 async+filelist（须整体
   * URL 编码，原样发 JSON 报 errno 2）。filelist 结构随 opera 变化：
   * delete 是纯路径字符串数组；move/rename 是对象数组，move 的 dest
   * 放在每个条目内（不是顶层参数）。rename 用 async=1 同步拿逐文件
   * 结果（目录不存在时 info[].errno=-9）；delete/move 用 async=2 异步
   * （errno 0 + taskid 即受理）。
   * errno 111 表示"有异步任务执行中"，可稍后重试——在 assertOk 之前
   * 拦截，避免被当成 token 失效触发无谓刷新。
   */
  async filemanager(
    accessToken: string,
    opera: BaiduFilemanagerOpera,
    entries: BaiduFilemanagerEntry[],
  ): Promise<void> {
    const query = new URLSearchParams({
      method: "filemanager",
      access_token: accessToken,
      opera,
    });
    const filelist =
      opera === "delete"
        ? JSON.stringify(entries.map((entry) => entry.path))
        : JSON.stringify(entries);
    const body = new URLSearchParams({
      async: opera === "rename" ? "1" : "2",
      filelist,
    });
    const response = await this.postForm(query, body, "网盘文件管理");
    const data = (await response.json()) as BaiduFilemanagerResponse;
    if (data.errno === 111) {
      throw new BaiduApiError("网盘异步任务执行中，稍后重试", 111);
    }
    if (data.errno === 0) {
      return;
    }
    // rename 同步模式下单文件错误在 info[] 里（如 -9 文件不存在），
    // 透传给调用方（重命名传播把 -9 视为"目录从未推送过"跳过）
    const failed = data.info?.find((entry) => entry.errno !== 0);
    throw new BaiduApiError(
      `网盘文件管理失败 (errno ${failed?.errno ?? data.errno})`,
      failed?.errno ?? data.errno,
    );
  }

  private async tokenRequest(
    params: URLSearchParams,
    context: string,
  ): Promise<BaiduTokenResponse> {
    const response = await fetch(`${OAUTH_TOKEN_URL}?${params.toString()}`);
    const data = (await response.json()) as Partial<BaiduTokenResponse> & {
      error?: string;
      error_description?: string;
    };
    if (!data.access_token || !data.refresh_token) {
      throw new BaiduApiError(
        `${context}失败 (${data.error ?? response.status}${data.error_description ? `: ${data.error_description}` : ""})`,
        response.status,
      );
    }
    return data as BaiduTokenResponse;
  }
}
