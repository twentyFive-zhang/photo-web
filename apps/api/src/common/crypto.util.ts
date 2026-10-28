import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM 加密百度 token 等敏感值。
 * 密文格式：`v1.<iv>.<tag>.<ciphertext>`（均 base64）。
 * APP_ENCRYPTION_KEY 长度不定，先 sha256 派生 32 字节密钥。
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptAes256Gcm(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptAes256Gcm(payload: string, secret: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("加密数据格式不合法");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
