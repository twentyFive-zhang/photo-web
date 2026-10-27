import type { PublicAlbum } from "@photo/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { fetchApi } from "@/lib/fetch-api";
import { exifLine, renditionUrl } from "@/lib/photo";

type PageProps = {
  params: Promise<{ publicId: string; photoPublicId: string }>;
};

async function loadAlbum(publicId: string): Promise<PublicAlbum | null> {
  try {
    return await fetchApi<PublicAlbum>(`/albums/${publicId}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { publicId, photoPublicId } = await params;
  const album = await loadAlbum(publicId);
  const photo = album?.photos.find((p) => p.publicId === photoPublicId);
  if (!album || !photo) {
    return { title: "照片不存在" };
  }
  const large = renditionUrl(photo, "LARGE");
  return {
    title: photo.title ?? `${album.title} · 照片`,
    description: photo.caption ?? undefined,
    openGraph: {
      title: photo.title ?? album.title,
      description: photo.caption ?? undefined,
      images: large ? [{ url: large }] : undefined,
    },
  };
}

export default function PhotoPage({ params }: PageProps) {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-10 sm:px-6">
      {/* params 与 API 数据均为运行时数据，Suspense 内动态流式渲染 */}
      <Suspense fallback={<p className="text-neutral-500">加载中…</p>}>
        <PhotoContent params={params} />
      </Suspense>
    </main>
  );
}

async function PhotoContent({ params }: PageProps) {
  const { publicId, photoPublicId } = await params;
  await connection();
  const album = await loadAlbum(publicId);

  if (!album) {
    notFound();
  }

  const index = album.photos.findIndex((p) => p.publicId === photoPublicId);
  if (index < 0) {
    notFound();
  }

  const photo = album.photos[index];
  // 单张专辑前后循环切换
  const prevPhoto =
    album.photos[(index - 1 + album.photos.length) % album.photos.length];
  const nextPhoto = album.photos[(index + 1) % album.photos.length];
  const large = renditionUrl(photo, "LARGE");
  const counter = `${index + 1} / ${album.photos.length}`;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link
          className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
          href={`/albums/${album.publicId}`}
        >
          ← {album.title}
        </Link>
        <span className="text-sm text-neutral-500">{counter}</span>
      </header>

      {large && (
        <figure className="flex min-h-[50vh] items-center justify-center">
          {/* biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化 */}
          <img
            alt={photo.title ?? "照片"}
            className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain"
            src={large}
          />
        </figure>
      )}

      {/* 原生链接导航：不依赖页面 JS */}
      <nav className="flex items-center justify-between">
        <Link
          className="flex items-center gap-1 rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500"
          href={`/albums/${album.publicId}/photos/${prevPhoto.publicId}`}
        >
          ← 上一张
        </Link>
        <Link
          className="flex items-center gap-1 rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500"
          href={`/albums/${album.publicId}/photos/${nextPhoto.publicId}`}
        >
          下一张 →
        </Link>
      </nav>

      <footer className="space-y-1 text-center text-sm text-neutral-400">
        {photo.title && (
          <p className="font-medium text-neutral-200">{photo.title}</p>
        )}
        {exifLine(photo) && <p>{exifLine(photo)}</p>}
        {photo.caption && <p>{photo.caption}</p>}
      </footer>
    </div>
  );
}
