/**
 * ADR 0005 存量迁移（一次性，可重复执行，幂等）：
 *
 * 1. 每张已镜像照片（netdiskFsId 非空）：经 dlink 下载网盘原件，sha256 与
 *    站内记录一致才删除本地暂存原件（母版自此只以网盘为权威）；
 * 2. 所有照片：删除已无引用的 large.webp（变体行已由 prisma 迁移清除）。
 *
 * 运行（在 apps/api 下执行，bun 自动读取该目录 .env）：
 *   cd apps/api && bun ../../scripts/migrate-adr0005-cleanup.ts
 *
 * 需要 DATABASE_URL、APP_ENCRYPTION_KEY（.env 已含）。
 * 网盘未连接 / dlink 不可用 / sha256 不一致时：跳过该照片的原件删除并告警
 * （本地母本保留，绝不盲删）；large.webp 清理不受影响。
 */
import { createHash } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  decryptAes256Gcm,
  encryptAes256Gcm,
} from "../src/common/crypto.util.js";

process.env.DATABASE_URL ??=
  "postgresql://photo:photo@localhost:5432/photo?schema=public";

const prisma = new PrismaClient();

const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";
const PAN_BASE = "https://pan.baidu.com";
const DOWNLOAD_UA = "pan.baidu.com";

const encryptionKey: string | undefined = process.env.APP_ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error("缺少 APP_ENCRYPTION_KEY（apps/api/.env 应已包含）");
  process.exit(1);
}

const storageRoot = resolve(process.env.STORAGE_DIR ?? "var/storage");

async function exists(key: string): Promise<boolean> {
  return stat(join(storageRoot, key)).then(
    () => true,
    () => false,
  );
}

async function deleteFile(key: string): Promise<boolean> {
  try {
    await unlink(join(storageRoot, key));
    return true;
  } catch {
    return false;
  }
}

interface Credential {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string | null;
}

async function readCredential(): Promise<Credential> {
  const row = await prisma.baiduCredential.findUnique({
    where: { id: "singleton" },
  });
  if (!row) {
    throw new Error(
      "网盘未连接（BaiduCredential 缺失）——仅执行 large.webp 清理，跳过原件删除",
    );
  }
  return {
    accessToken: decryptAes256Gcm(row.accessToken, encryptionKey),
    refreshToken: decryptAes256Gcm(row.refreshToken, encryptionKey),
    expiresAt: row.expiresAt,
    scope: row.scope,
  };
}

/** refresh_token 一次性：刷新成功必须把新 token 对落库（与 credential 服务同语义）。 */
async function refresh(credential: Credential): Promise<void> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
    client_id: process.env.BAIDU_APP_KEY ?? "",
    client_secret: process.env.BAIDU_APP_SECRET ?? "",
  });
  const response = await fetch(`${OAUTH_TOKEN_URL}?${params.toString()}`);
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      `刷新 access_token 失败（${data.error ?? response.status}），请重新授权`,
    );
  }
  const payload = {
    accessToken: encryptAes256Gcm(data.access_token, encryptionKey),
    refreshToken: encryptAes256Gcm(data.refresh_token, encryptionKey),
    expiresAt: new Date(Date.now() + (data.expires_in ?? 0) * 1000),
    scope: data.scope || credential.scope || "",
  };
  await prisma.baiduCredential.update({
    where: { id: "singleton" },
    data: payload,
  });
  credential.accessToken = data.access_token;
  credential.refreshToken = data.refresh_token;
  credential.expiresAt = payload.expiresAt;
  console.log("  access_token 已刷新并落库");
}

async function filemetas(
  credential: Credential,
  fsId: string,
): Promise<{ dlink?: string; path?: string }> {
  const call = async (token: string) => {
    const params = new URLSearchParams({
      method: "filemetas",
      access_token: token,
      fsids: JSON.stringify([Number(fsId)]),
      dlink: "1",
    });
    const response = await fetch(
      `${PAN_BASE}/rest/2.0/xpan/multimedia?${params.toString()}`,
    );
    const data = (await response.json()) as {
      errno: number;
      list?: { dlink?: string; path?: string }[];
    };
    return { response, data };
  };

  let { data } = await call(credential.accessToken);
  if (data.errno === -6 || data.errno === 111) {
    await refresh(credential);
    ({ data } = await call(credential.accessToken));
  }
  if (data.errno !== 0) {
    throw new Error(`filemetas 失败 (errno ${data.errno})`);
  }
  return data.list?.[0] ?? {};
}

async function downloadOriginal(
  credential: Credential,
  dlink: string,
): Promise<Buffer> {
  const url = `${dlink}${dlink.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(credential.accessToken)}`;
  const response = await fetch(url, { headers: { "User-Agent": DOWNLOAD_UA } });
  if (!response.ok) {
    throw new Error(`下载失败 (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // dlink 错误可能以 JSON + 200 返回，检测拦截
  if (buffer.length < 512 && buffer[0] === 0x7b) {
    const parsed = JSON.parse(buffer.toString("utf8")) as { errno?: number };
    if (typeof parsed.errno === "number" && parsed.errno !== 0) {
      throw new Error(`下载失败 (errno ${parsed.errno})`);
    }
  }
  return buffer;
}

async function main(): Promise<void> {
  const photos = await prisma.photo.findMany({
    select: {
      id: true,
      publicId: true,
      title: true,
      originalKey: true,
      sha256: true,
      netdiskFsId: true,
      album: { select: { title: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`共 ${photos.length} 张照片；存储根目录 ${storageRoot}\n`);

  let credential: Credential | null = null;
  try {
    credential = await readCredential();
  } catch (error) {
    console.warn(`⚠ ${error instanceof Error ? error.message : error}\n`);
  }

  let originalsDeleted = 0;
  let originalsSkipped = 0;
  let largeDeleted = 0;

  for (const photo of photos) {
    const largeKey = `photos/${photo.publicId}/large.webp`;
    if (await exists(largeKey)) {
      if (await deleteFile(largeKey)) {
        largeDeleted += 1;
        console.log(`  已删除 large.webp：${largeKey}`);
      }
    }

    if (!photo.netdiskFsId) {
      continue;
    }
    const label = `${photo.title ?? photo.publicId}（${photo.album.title}）`;
    if (!credential) {
      originalsSkipped += 1;
      console.warn(`⚠ 跳过原件删除（网盘未连接）：${label}`);
      continue;
    }

    try {
      const meta = await filemetas(credential, photo.netdiskFsId);
      if (!meta.dlink) {
        throw new Error("未获取到 dlink");
      }
      const buffer = await downloadOriginal(credential, meta.dlink);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (sha256 !== photo.sha256) {
        throw new Error(
          `sha256 校验不一致（网盘 ${sha256.slice(0, 12)}… ≠ 站内 ${photo.sha256.slice(0, 12)}…）`,
        );
      }
      const hadOriginal = await exists(photo.originalKey);
      if (hadOriginal && (await deleteFile(photo.originalKey))) {
        originalsDeleted += 1;
        console.log(`✓ 已删除本地暂存原件（网盘校验一致）：${label}`);
      } else {
        console.log(`- 本地无原件（无需处理）：${label}`);
      }
    } catch (error) {
      originalsSkipped += 1;
      console.warn(
        `⚠ 跳过原件删除（保留本地母本）：${label} → ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  console.log(
    `\n完成：删除暂存原件 ${originalsDeleted} 个，跳过 ${originalsSkipped} 张，删除 large.webp ${largeDeleted} 个。`,
  );
  console.log(
    "注意：PhotoRendition 的 LARGE 行由 prisma 迁移（20261122000000_adr0005_drop_large_renditions）负责清除。",
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
