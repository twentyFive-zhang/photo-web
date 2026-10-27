import type { PublicAlbum } from "@photo/shared";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PhotoGallery } from "@/app/albums/[publicId]/photo-gallery";
import { fetchApi } from "@/lib/fetch-api";

type PageProps = { params: Promise<{ shareToken: string }> };

async function loadAlbum(shareToken: string): Promise<PublicAlbum | null> {
  try {
    return await fetchApi<PublicAlbum>(`/share/${shareToken}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { shareToken } = await params;
  const album = await loadAlbum(shareToken);

  return {
    title: album?.title ?? "链接已失效",
    // 仅链接可见专辑：不允许收录
    robots: { index: false, follow: false },
  };
}

export default function SharePage({ params }: PageProps) {
  return (
    <main className="mx-auto min-h-[70vh] max-w-6xl space-y-8 px-6 py-16">
      <Suspense fallback={<p className="text-neutral-500">加载中…</p>}>
        <ShareContent params={params} />
      </Suspense>
    </main>
  );
}

async function ShareContent({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  await connection();
  const album = await loadAlbum(shareToken);

  if (!album) {
    return (
      <div className="space-y-3 py-16 text-center">
        <h1 className="text-2xl font-medium">链接已失效</h1>
        <p className="text-neutral-500">这个分享链接不存在或已被重置。</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-4xl font-medium tracking-tight">{album.title}</h1>
      <p className="text-sm text-neutral-500">
        仅链接可见 · {album.photos.length} 张照片
      </p>

      <div className="pt-4">
        {album.photos.length === 0 ? (
          <p className="text-neutral-500">这个专辑还没有照片。</p>
        ) : (
          <PhotoGallery albumPublicId={album.publicId} photos={album.photos} />
        )}
      </div>
    </>
  );
}
