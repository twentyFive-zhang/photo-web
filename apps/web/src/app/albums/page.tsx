import type { PublicAlbumSummary } from "@photo/shared";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { fetchApi } from "@/lib/fetch-api";

export const metadata = {
  title: "专辑",
  description: "江流儿的摄影专辑",
};

export default function AlbumsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">
          Albums
        </p>
        <h1 className="text-4xl font-medium tracking-tight text-neutral-100">
          专辑
        </h1>
      </header>

      <Suspense fallback={<p className="text-neutral-500">加载中…</p>}>
        <AlbumList />
      </Suspense>
    </main>
  );
}

async function AlbumList() {
  await connection();

  let albums: PublicAlbumSummary[] = [];
  try {
    albums = await fetchApi<PublicAlbumSummary[]>("/albums");
  } catch {
    // API 不可用时显示空态，不阻塞页面
  }

  if (albums.length === 0) {
    return <p className="text-neutral-500">还没有公开的专辑，敬请期待。</p>;
  }

  return (
    <ul className="grid gap-6 sm:grid-cols-2">
      {albums.map((album) => (
        <li key={album.publicId}>
          <Link
            className="group block space-y-3"
            href={`/albums/${album.publicId}`}
          >
            <div className="aspect-[3/2] overflow-hidden rounded-2xl bg-neutral-900">
              {album.coverUrl ? (
                // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                <img
                  alt={`${album.title} 封面`}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  src={album.coverUrl}
                />
              ) : null}
            </div>
            <div className="space-y-1">
              <h2 className="font-medium text-neutral-100">{album.title}</h2>
              <p className="text-sm text-neutral-500">
                {album.photoCount} 张照片
                {album.publishedAt
                  ? ` · ${new Date(album.publishedAt).toLocaleDateString("zh-CN")}`
                  : ""}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
