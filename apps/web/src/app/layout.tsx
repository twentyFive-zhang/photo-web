import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
