import type { PublicAlbum } from "@photo/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { fetchApi } from "@/lib/api";
import { PhotoGallery } from "./photo-gallery";

type PageProps = { params: Promise<{ publicId: string }> };

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
  const { publicId } = await params;
  const album = await loadAlbum(publicId);
  if (!album) {
    return { title: "专辑不存在" };
  }
  const ogImage = album.photos[0]?.renditions.find(
    (r) => r.variant === "DISPLAY",
  )?.url;
  return {
    title: album.title,
    description: album.description ?? `${album.title} — 江流儿摄影专辑`,
    openGraph: {
      title: album.title,
      description: album.description ?? undefined,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
  };
}

export default function AlbumDetailPage({ params }: PageProps) {
  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-8 px-6 py-16">
      <header className="space-y-3">
        <Link
          className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
          href="/albums"
        >
          ← 全部专辑
        </Link>
        {/* params 与 API 数据均为运行时数据，Suspense 内动态流式渲染 */}
        <Suspense fallback={<p className="text-neutral-500">加载中…</p>}>
          <AlbumContent params={params} />
        </Suspense>
      </header>
    </main>
  );
}

async function AlbumContent({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  await connection();
  const album = await loadAlbum(publicId);

  if (!album) {
    notFound();
  }

  return (
    <>
      <h1 className="text-4xl font-medium tracking-tight text-neutral-100">
        {album.title}
      </h1>
      <p className="text-sm text-neutral-500">
        {album.photos.length} 张照片
        {album.publishedAt
          ? ` · ${new Date(album.publishedAt).toLocaleDateString("zh-CN")}`
          : ""}
      </p>
      {album.description && (
        <p className="max-w-2xl text-neutral-400">{album.description}</p>
      )}

      <div className="pt-4">
        {album.photos.length === 0 ? (
          <p className="text-neutral-500">这个专辑还没有照片。</p>
        ) : (
          <PhotoGallery photos={album.photos} />
        )}
      </div>
    </>
  );
}
