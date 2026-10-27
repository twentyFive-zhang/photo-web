import type { PublicAlbumSummary } from "@photo/shared";
import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/albums`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/about`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${siteUrl}/contact`, changeFrequency: "yearly", priority: 0.5 },
  ];

  // 公开专辑页；构建/生成时 API 不可用则只输出静态路由
  try {
    const res = await fetch(`${apiBase}/api/albums`);
    if (!res.ok) return staticRoutes;
    const albums = (await res.json()) as PublicAlbumSummary[];
    return [
      ...staticRoutes,
      ...albums.map((album) => ({
        url: `${siteUrl}/albums/${album.publicId}`,
        lastModified: album.publishedAt
          ? new Date(album.publishedAt)
          : undefined,
        changeFrequency: "monthly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return staticRoutes;
  }
}
