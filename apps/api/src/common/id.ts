import { randomBytes } from "node:crypto";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomId(length: number): string {
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}

/** 专辑/照片的短 ID，6 位 base62，配合唯一约束重试。 */
export const generatePublicId = () => randomId(6);

/** 仅链接可见专辑的分享 token，24 位，不可猜测。 */
export const generateShareToken = () => randomId(24);
