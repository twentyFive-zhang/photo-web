"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

/** 专辑页"复制链接"分享按钮（微信转发常用）。 */
export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-3.5 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200"
      onClick={async () => {
        if (await copyText(window.location.href)) {
          setCopied(true);
          toast.success("链接已复制，去粘贴给朋友吧");
          setTimeout(() => setCopied(false), 1500);
        } else {
          toast.error("复制失败，请手动复制地址栏链接");
        }
      }}
      type="button"
    >
      <Link2 size={13} />
      {copied ? "已复制" : "复制链接"}
    </button>
  );
}
