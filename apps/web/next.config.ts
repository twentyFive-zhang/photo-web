import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    // API 返回的媒体 URL 是相对路径 /media/...，同源代理到 API
    const api = process.env.API_URL ?? "http://localhost:3001";
    return [{ source: "/media/:path*", destination: `${api}/media/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
