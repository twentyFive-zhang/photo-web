import { BadRequestException } from "@nestjs/common";

/** 2026-06-03 后创建的应用，文件接口只能访问 /apps/{应用名}/。 */
export const BAIDU_BROWSE_ROOT = "/apps";

/**
 * 浏览/写入根：配置了 BAIDU_APP_NAME 时锁定应用目录
 * （/apps 虚拟根部分账号不可列）。浏览与写操作（新建/删除/上传）共用。
 */
export function baiduRootOf(appName: string | undefined): string {
  return appName ? `${BAIDU_BROWSE_ROOT}/${appName}` : BAIDU_BROWSE_ROOT;
}

/**
 * 写操作路径边界：目录/文件路径必须严格位于 root 内，且不含 ".." 段。
 * 越界抛 400（JIANGLIUER-94：新建/删除/上传统一走这里）。
 */
export function assertManagedPath(root: string, raw: string): string {
  const path = raw.trim().replace(/\/+$/, "");
  if (!path.startsWith(`${root}/`) || path.split("/").includes("..")) {
    throw new BadRequestException(`路径越界：只能操作 ${root}/ 下的内容`);
  }
  return path;
}

/**
 * 归一化一个「父目录」参数（新建/上传落点）：空、"/"、root 本身都归一到
 * root；其余必须位于 root 内（复用 assertManagedPath 的边界与 ".." 校验）。
 */
export function normalizeManagedDir(root: string, raw?: string): string {
  const dir = raw?.trim();
  if (!dir || dir === "/" || dir === root || dir === BAIDU_BROWSE_ROOT) {
    return root;
  }
  return assertManagedPath(root, dir);
}
