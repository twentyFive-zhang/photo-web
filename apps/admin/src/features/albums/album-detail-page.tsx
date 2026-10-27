import type { Album } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type ChangeEvent, useRef, useState } from "react";
import { apiFetch, mediaUrl } from "../../lib/api.js";

/** GET /admin/albums/:id/photos 的行结构（与 shared Photo 兼容的子集）。 */
interface AdminPhotoRow {
  id: string;
  publicId: string;
  title: string | null;
  width: number;
  height: number;
  renditions: {
    variant: "THUMB" | "DISPLAY" | "LARGE";
    format: string;
    key: string;
    width: number;
    height: number;
  }[];
}

function thumbUrl(photo: AdminPhotoRow): string | null {
  const thumb = photo.renditions.find((r) => r.variant === "THUMB");
  return thumb ? mediaUrl(thumb.key) : null;
}

export function AlbumDetailPage() {
  const { albumId } = useParams({ from: "/albums/$albumId" });
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const albumQuery = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => apiFetch<Album>(`/admin/albums/${albumId}`),
  });

  const photosQuery = useQuery({
    queryKey: ["album-photos", albumId],
    queryFn: () => apiFetch<AdminPhotoRow[]>(`/admin/albums/${albumId}/photos`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["album", albumId] });
    queryClient.invalidateQueries({ queryKey: ["album-photos", albumId] });
    queryClient.invalidateQueries({ queryKey: ["albums"] });
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        await apiFetch(`/admin/albums/${albumId}/photos/upload`, {
          method: "POST",
          body: form,
        });
      }
    },
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<void>(`/admin/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: "PUBLIC" | "UNLISTED") =>
      apiFetch<Album>(`/admin/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError(null);
    uploadMutation.mutate(files);
  }

  const album = albumQuery.data;

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            className="text-sm text-neutral-500 hover:text-white"
            to="/albums"
          >
            ← 全部专辑
          </Link>
          <h1 className="text-2xl font-medium">{album?.title ?? "加载中…"}</h1>
        </div>
        {album && (
          <button
            className={
              album.visibility === "PUBLIC"
                ? "rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400"
                : "rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
            }
            disabled={visibilityMutation.isPending}
            onClick={() =>
              visibilityMutation.mutate(
                album.visibility === "PUBLIC" ? "UNLISTED" : "PUBLIC",
              )
            }
            type="button"
          >
            {album.visibility === "PUBLIC" ? "取消公开" : "发布（公开）"}
          </button>
        )}
      </div>

      <label className="inline-block cursor-pointer rounded-full border border-dashed border-neutral-600 px-5 py-2.5 text-sm text-neutral-300 hover:border-neutral-400">
        {uploadMutation.isPending ? "上传中…" : "上传照片（JPEG / PNG / WebP）"}
        <input
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          multiple
          onChange={handleFilesSelected}
          ref={fileInputRef}
          type="file"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {photosQuery.isPending && <p className="text-neutral-400">加载中…</p>}
      {photosQuery.data?.length === 0 && (
        <p className="text-neutral-500">还没有照片，点上面按钮上传。</p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photosQuery.data?.map((photo) => {
          const url = thumbUrl(photo);
          return (
            <li
              className="group relative overflow-hidden rounded-xl border border-neutral-800"
              key={photo.id}
            >
              {url ? (
                // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                <img
                  alt={photo.title ?? "照片"}
                  className="aspect-square w-full object-cover"
                  src={url}
                />
              ) : (
                <div className="flex aspect-square items-center justify-center text-neutral-600">
                  无预览
                </div>
              )}
              <button
                aria-label="删除照片"
                className="absolute top-2 right-2 hidden rounded-full bg-black/70 px-2 py-1 text-xs text-red-300 group-hover:block"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(photo.id)}
                type="button"
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
