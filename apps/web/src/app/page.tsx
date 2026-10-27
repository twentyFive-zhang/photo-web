import type { PublicAlbumSummary, PublicFeaturedPhoto } from "@photo/shared";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { fetchApi } from "@/lib/fetch-api";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-24">
      <section className="w-full max-w-2xl space-y-6 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">
          Jiangliuer Photography
        </p>
        <h1 className="text-5xl font-medium tracking-tight text-neutral-100 sm:text-7xl">
          江流儿摄影
        </h1>
        <p className="mx-auto max-w-md text-base leading-7 text-neutral-400">
          光与影的记录。作品集正在整理中，很快见。
        </p>
        <div className="mx-auto h-px w-16 bg-neutral-800" />
        <p className="text-sm text-neutral-600">个人摄影作品</p>
        <Link
          className="inline-block rounded-full border border-neutral-700 px-5 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-400"
          href="/albums"
        >
          浏览专辑
        </Link>
      </section>

      {/* 精选 + 最新专辑：运行时数据，Suspense 内动态流式渲染 */}
      <Suspense fallback={null}>
        <FeaturedStrip />
      </Suspense>
      <Suspense fallback={null}>
        <LatestAlbums />
      </Suspense>
    </main>
  );
}

async function FeaturedStrip() {
  await connection();

  let photos: PublicFeaturedPhoto[] = [];
  try {
    photos = await fetchApi<PublicFeaturedPhoto[]>("/featured");
  } catch {
    // API 不可用时隐藏区块
    return null;
  }
  if (photos.length === 0) {
    return null;
  }

  return (
    <section className="mt-20 w-full max-w-4xl space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-neutral-200">精选</h2>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) => {
          const thumb = photo.renditions.find((r) => r.variant === "DISPLAY");
          if (!thumb) return null;
          return (
            <li key={photo.publicId}>
              <Link href={`/albums/${photo.album.publicId}`}>
                {/* biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化 */}
                <img
                  alt={photo.title ?? "精选照片"}
                  className="aspect-square w-full rounded-xl object-cover transition-opacity hover:opacity-80"
                  loading="lazy"
                  src={thumb.url}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function LatestAlbums() {
  await connection();

  let albums: PublicAlbumSummary[] = [];
  try {
    albums = (await fetchApi<PublicAlbumSummary[]>("/albums")).slice(0, 4);
  } catch {
    // API 不可用时隐藏区块
    return null;
  }

  if (albums.length === 0) {
    return null;
  }

  return (
    <section className="mt-20 w-full max-w-4xl space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-neutral-200">最新专辑</h2>
        <Link
          className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
          href="/albums"
        >
          全部 →
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {albums.map((album) => (
          <li key={album.publicId}>
            <Link
              className="group block space-y-2"
              href={`/albums/${album.publicId}`}
            >
              <div className="aspect-[3/2] overflow-hidden rounded-2xl bg-neutral-900">
                {album.coverUrl && (
                  // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                  <img
                    alt={`${album.title} 封面`}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    src={album.coverUrl}
                  />
                )}
              </div>
              <p className="font-medium text-neutral-200">{album.title}</p>
              <p className="text-sm text-neutral-500">
                {album.photoCount} 张照片
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
