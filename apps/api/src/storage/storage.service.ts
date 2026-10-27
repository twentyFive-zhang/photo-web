import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { ConfigService } from "@nestjs/config";

/**
 * 存储抽象：M3 用本地磁盘（root 目录 + /media 静态服务）。
 * M6 部署时替换为 COS 实现，接口不变。
 * key 形如 `photos/{publicId}/thumb.webp`，不含 media 前缀。
 */
@Injectable()
export class StorageService {
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>("STORAGE_DIR", "var/storage"));
    this.baseUrl = config
      .get<string>("CDN_BASE_URL", "/media")
      .replace(/\/+$/, "");
  }

  /** 静态服务挂载点（main.ts 使用）。 */
  get rootPath(): string {
    return this.root;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = join(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  /** 尽力删除：文件不存在时忽略；删除后若父目录为空则一并移除。 */
  async deleteMany(keys: string[]): Promise<void> {
    const dirs = new Set<string>();
    await Promise.all(
      keys.map((key) => {
        const target = join(this.root, key);
        dirs.add(dirname(target));
        return unlink(target).catch(() => undefined);
      }),
    );
    await Promise.all(
      [...dirs].map((dir) => rmdir(dir).catch(() => undefined)),
    );
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
