/**
 * ADR 0006 后目录名与专辑标题彻底解耦：推送母版统一落
 * /apps/{应用名}/library/{publicId}.{ext}，不再需要标题→目录名的派生。
 * shared 里的 sanitizeNetdiskName 仅服务于网盘直接管理通道（JIANGLIUER-94
 * 新建文件夹/直接上传的文件名清洗），与本模块无关。
 */
export const NETDISK_LIBRARY_DIR = "library";

/** 推送母版落点文件名：{publicId}.{ext}（ext 从 originalKey 推导）。 */
export function netdiskLibraryFilename(input: {
  publicId: string;
  originalKey: string;
}): string {
  const ext = input.originalKey.split(".").pop() ?? "bin";
  return `${input.publicId}.${ext}`;
}
