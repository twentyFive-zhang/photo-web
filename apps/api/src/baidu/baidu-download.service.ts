// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduApiService } from "./baidu-api.service.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { BaiduCredentialService } from "./baidu-credential.service.js";

export interface BaiduOriginalDownload {
  buffer: Buffer;
  /** 网盘侧完整路径（/apps/{应用名}/…），导入回写映射用。 */
  path: string | null;
}

/**
 * 网盘原件下载段（导入管线与「从网盘重建变体」共用，ADR 0005）：
 * filemetas 现取 dlink → 服务端下载。dlink 有时效且不可落库，绝不持久化。
 */
export class BaiduDownloadService {
  constructor(
    private readonly baiduApi: BaiduApiService,
    private readonly credentials: BaiduCredentialService,
  ) {}

  async downloadByFsId(fsId: number): Promise<BaiduOriginalDownload> {
    const accessToken = await this.credentials.getValidAccessToken();
    const metas = await this.baiduApi.filemetas(accessToken, [fsId]);
    const meta = metas[0];
    if (!meta?.dlink) {
      throw new Error("未获取到下载地址");
    }
    const buffer = await this.baiduApi.download(meta.dlink, accessToken);
    return { buffer, path: meta.path ?? null };
  }
}
