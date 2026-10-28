/** 网盘文件名非法字符（Windows 风格），统一替换为下划线。 */
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;

/** 专辑标题/文件名 → 网盘安全目录名（非法字符替换、去首尾空白）。 */
export function sanitizeNetdiskName(name: string): string {
  const cleaned = name.replace(ILLEGAL_CHARS, "_").trim();
  return cleaned.length > 0 ? cleaned : "_";
}

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
