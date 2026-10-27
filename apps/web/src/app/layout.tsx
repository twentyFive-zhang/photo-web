import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/toaster";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "江流儿摄影",
    template: "%s | 江流儿摄影",
  },
  description: "江流儿的个人摄影作品集。",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "江流儿摄影",
    title: "江流儿摄影",
    description: "江流儿的个人摄影作品集。",
    url: siteUrl,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body className="bg-neutral-950 text-neutral-100 antialiased">
        {/* 站点设置依赖运行时 API，Suspense 内流式渲染 */}
        <Suspense fallback={<div className="h-[57px]" />}>
          <SiteHeader />
        </Suspense>
        {children}
        <Suspense fallback={null}>
          <SiteFooter />
        </Suspense>
        <Toaster />
      </body>
    </html>
  );
}
