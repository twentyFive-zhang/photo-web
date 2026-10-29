import type { Album } from "@photo/shared";
import { Copy, Download, ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";

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
    <Card className="flex-1">
      <CardContent className="space-y-3 text-center">
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
        <a
          className="flex items-center justify-center gap-1 text-xs break-all text-neutral-500 hover:text-neutral-300"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {url}
          <ExternalLink size={11} className="shrink-0" />
        </a>
        <div className="flex justify-center gap-2">
          <Button
            onClick={async () => {
              if (await copyText(url)) {
                setCopied(true);
                toast.success("链接已复制");
                setTimeout(() => setCopied(false), 1500);
              } else {
                toast.error("复制失败，请手动长按链接复制");
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Copy size={12} />
            {copied ? "已复制" : "复制链接"}
          </Button>
          <Button
            disabled={!dataUrl}
            onClick={() => dataUrl && downloadDataUrl(dataUrl, filename)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download size={12} />
            下载 PNG
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function QrDialog({
  album,
  open,
  onOpenChange,
}: {
  album: Album;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const base = webBaseUrl();
  const publicUrl = `${base}/albums/${album.publicId}`;
  const shareUrl = `${base}/s/${album.shareToken}`;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>专辑二维码</DialogTitle>
          <DialogDescription>
            手机连同一 Wi-Fi 后扫码打开；地址 = 前台地址（
            {import.meta.env.VITE_PUBLIC_BASE_URL
              ? "VITE_PUBLIC_BASE_URL"
              : "当前访问域名"}
            ）。
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}

/** "手机管理"弹窗：扫码在手机上打开后台。 */
export function AdminQrDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>手机管理</DialogTitle>
          <DialogDescription>扫码在手机上打开后台管理。</DialogDescription>
        </DialogHeader>
        <QrCard
          filename="admin-qr.png"
          label="后台管理地址"
          url={`${adminBaseUrl()}/`}
        />
      </DialogContent>
    </Dialog>
  );
}
