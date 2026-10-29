import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/admin/",
  // 读取仓库根目录的 .env（VITE_PUBLIC_BASE_URL 等客户端可见变量）
  envDir: "../..",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  server: {
    // 暴露到局域网，手机扫码直接访问后台
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/media": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
