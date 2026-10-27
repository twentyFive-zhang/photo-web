import type { Album } from "@photo/shared";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/**
 * 二维码里用的前台地址：
 * 1. 优先 VITE_PUBLIC_BASE_URL（生产环境配 https://jiangliuer.com）；
 * 2. 未设置时用当前 admin 的 hostname 拼 web 端口 —— dev 用局域网 IP 打开
 *    后台即可生成手机可扫的局域网码。
 */
function webBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://${window.location.hostname}:3000`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

/** 二维码里用的后台地址：优先 VITE_PUBLIC_ADMIN_BASE_URL，否则当前 hostname 拼 dev 端口。 */
export function adminBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_ADMIN_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://${window.location.hostname}:5173/admin`;
}

function QrCard({
  label,
  url,
  filename,
}: {
  label: string;
  url: string;
  filename: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 512, margin: 2 })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="flex-1 space-y-3 rounded-2xl border border-neutral-800 p-5 text-center">
      <h3 className="text-sm font-medium text-neutral-300">{label}</h3>
      {dataUrl ? (
        // biome-ignore lint/performance/noImgElement: data URL 由 qrcode 库本地生成，不走 next/image
        <img
          alt={`${label}二维码`}
          className="mx-auto w-48 rounded-lg bg-white p-2"
          src={dataUrl}
        />
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-neutral-600">
          生成中…
        </div>
      )}
      <p className="text-xs break-all text-neutral-500">{url}</p>
      <div className="flex justify-center gap-2">
        <button
          className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-400"
          onClick={async () => {
            if (await copyText(url)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          type="button"
        >
          {copied ? "已复制" : "复制链接"}
        </button>
        <button
          className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-400 disabled:opacity-40"
          disabled={!dataUrl}
          onClick={() => dataUrl && downloadDataUrl(dataUrl, filename)}
          type="button"
        >
          下载 PNG
        </button>
      </div>
    </div>
  );
}

export function QrDialog({
  album,
  onClose,
}: {
  album: Album;
  onClose: () => void;
}) {
  const base = webBaseUrl();
  const publicUrl = `${base}/albums/${album.publicId}`;
  const shareUrl = `${base}/s/${album.shareToken}`;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 弹窗遮罩点击关闭，关闭有按钮
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="w-full max-w-xl space-y-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">专辑二维码</h2>
          <button
            className="text-sm text-neutral-500 hover:text-white"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          手机连同一 Wi-Fi 后扫码打开；地址 = 前台地址（
          {import.meta.env.VITE_PUBLIC_BASE_URL
            ? "VITE_PUBLIC_BASE_URL"
            : "当前访问域名"}
          ）。
        </p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <QrCard
            filename={`album-${album.publicId}-public.png`}
            label="公开链接"
            url={publicUrl}
          />
          <QrCard
            filename={`album-${album.publicId}-share.png`}
            label="分享链接（仅链接可见）"
            url={shareUrl}
          />
        </div>
      </div>
    </div>
  );
}

/** "手机管理"弹窗：扫码在手机上打开后台。 */
export function AdminQrDialog({ onClose }: { onClose: () => void }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 弹窗遮罩点击关闭，关闭有按钮
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">手机管理</h2>
          <button
            className="text-sm text-neutral-500 hover:text-white"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>
        <QrCard
          filename="admin-qr.png"
          label="后台管理地址"
          url={`${adminBaseUrl()}/`}
        />
      </div>
    </div>
  );
}
