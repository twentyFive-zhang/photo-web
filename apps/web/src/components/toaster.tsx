"use client";

import { Toaster as SonnerToaster } from "sonner";

/** 全站 toast 挂载点（复制链接等轻提示）。 */
export function Toaster() {
  return <SonnerToaster position="bottom-center" />;
}
