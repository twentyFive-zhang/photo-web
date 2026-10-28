import type { BaiduDirectoryListing, BaiduFileEntry } from "@photo/shared";
import type { BaiduListResponse } from "./baidu-api.service.js";

/** 百度 list 响应 → 后台目录浏览视图。 */
export function toBaiduDirectoryListing(
  dir: string,
  page: number,
  response: BaiduListResponse,
): BaiduDirectoryListing {
  const list = response.list ?? [];
  const entries: BaiduFileEntry[] = list.map((entry) => ({
    fsId: entry.fs_id,
    path: entry.path,
    serverFilename: entry.server_filename,
    isDir: entry.isdir === 1,
    size: entry.size,
    category: entry.category ?? null,
    thumbUrl:
      entry.thumbs?.url3 ?? entry.thumbs?.url2 ?? entry.thumbs?.url1 ?? null,
    mtime: entry.server_mtime,
  }));
  return {
    dir,
    page,
    // 满页假定还有下一页（百度 list 无总数字段，多翻一页得空列表即止）
    hasMore: list.length >= 100,
    entries,
  };
}
