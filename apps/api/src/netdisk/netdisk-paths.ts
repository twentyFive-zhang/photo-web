// sanitize 规则 admin 端做目录↔专辑对照也要用，单一实现在 shared
import { sanitizeNetdiskName } from "@photo/shared";

export { sanitizeNetdiskName };

/** 镜像文件名：标题（无则 publicId）- publicId.扩展名，publicId 后缀保证唯一。 */
export function netdiskFilename(input: {
  title: string | null;
  publicId: string;
  originalKey: string;
}): string {
  const ext = input.originalKey.split(".").pop() ?? "bin";
  const base = sanitizeNetdiskName(input.title || input.publicId);
  return `${base}-${input.publicId}.${ext}`;
}
