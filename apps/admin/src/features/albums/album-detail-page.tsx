import type { Album } from "@photo/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { apiFetch, mediaUrl } from "../../lib/api.js";
import {
  AdminShell,
  type AlbumPhotoRow,
  useFeaturedIds,
  useInvalidateAlbum,
} from "../../lib/shell.js";

function thumbUrl(photo: AlbumPhotoRow): string | null {
  const thumb = photo.renditions.find((r) => r.variant === "THUMB");
  return thumb ? mediaUrl(thumb.key) : null;
}

export function AlbumDetailPage() {
  const { albumId } = useParams({ from: "/albums/$albumId" });

  return (
    <AdminShell>
      <AlbumDetail albumId={albumId} />
    </AdminShell>
  );
}

function AlbumDetail({ albumId }: { albumId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AlbumPhotoRow | null>(null);

  const invalidate = useInvalidateAlbum(albumId);

  const albumQuery = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => apiFetch<Album>(`/admin/albums/${albumId}`),
  });

  const photosQuery = useQuery({
    queryKey: ["album-photos", albumId],
    queryFn: () => apiFetch<AlbumPhotoRow[]>(`/admin/albums/${albumId}/photos`),
  });

  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => apiFetch<Album[]>("/admin/albums"),
  });

  const featuredIds = useFeaturedIds();

  const fail = (err: Error) => setError(err.message);

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
    onError: fail,
  });

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<void>(`/admin/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: fail,
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch<{ deleted: number }>("/admin/photos/batch-delete", {
        method: "POST",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: fail,
  });

  const batchMoveMutation = useMutation({
    mutationFn: (targetAlbumId: string) =>
      apiFetch<{ moved: number }>("/admin/photos/batch-move", {
        method: "POST",
        body: JSON.stringify({ photoIds: [...selected], targetAlbumId }),
      }),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: fail,
  });

  const reorderMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch<void>(`/admin/albums/${albumId}/photos/reorder`, {
        method: "POST",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: invalidate,
    onError: fail,
  });

  const coverMutation = useMutation({
    mutationFn: (coverPhotoId: string) =>
      apiFetch<Album>(`/admin/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify({ coverPhotoId }),
      }),
    onSuccess: invalidate,
    onError: fail,
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: "PUBLIC" | "UNLISTED") =>
      apiFetch<Album>(`/admin/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
    onSuccess: invalidate,
    onError: fail,
  });

  const addFeaturedMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch("/admin/featured", {
        method: "PUT",
        body: JSON.stringify({ photoIds: [...featuredIds, photoId] }),
      }),
    onSuccess: invalidate,
    onError: fail,
  });

  const photos = photosQuery.data ?? [];

  function move(photoId: string, delta: -1 | 1) {
    const index = photos.findIndex((photo) => photo.id === photoId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    reorderMutation.mutate(next.map((photo) => photo.id));
  }

  function toggleSelect(photoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError(null);
    uploadMutation.mutate(files);
  }

  const album = albumQuery.data;

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            className="text-sm text-neutral-500 hover:text-white"
            to="/albums"
          >
            ← 全部专辑
          </Link>
          <h1 className="text-2xl font-medium">{album?.title ?? "加载中…"}</h1>
          {album && (
            <p className="text-sm text-neutral-500">
              {album.visibility === "PUBLIC" ? "公开" : "仅链接"} ·{" "}
              {album.photoCount} 张照片 · 封面：
              {album.coverPhotoId ? "手动设置" : "第一张"}
            </p>
          )}
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

      {/* 上传 + 批量操作工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-full border border-dashed border-neutral-600 px-5 py-2.5 text-sm text-neutral-300 hover:border-neutral-400">
          {uploadMutation.isPending ? "上传中…" : "上传照片"}
          <input
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            multiple
            onChange={handleFilesSelected}
            ref={fileInputRef}
            type="file"
          />
        </label>

        {selected.size > 0 && (
          <>
            <span className="text-sm text-neutral-400">
              已选 {selected.size} 张
            </span>
            <select
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
              defaultValue=""
              disabled={batchMoveMutation.isPending}
              onChange={(event) => {
                if (event.target.value)
                  batchMoveMutation.mutate(event.target.value);
                event.target.value = "";
              }}
            >
              <option disabled value="">
                移动到…
              </option>
              {albumsQuery.data
                ?.filter((target) => target.id !== albumId)
                .map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.title}
                  </option>
                ))}
            </select>
            <button
              className="rounded-full border border-red-900 px-4 py-2 text-sm text-red-300 hover:border-red-500"
              disabled={batchDeleteMutation.isPending}
              onClick={() => {
                if (confirm(`确定删除选中的 ${selected.size} 张照片？`)) {
                  batchDeleteMutation.mutate([...selected]);
                }
              }}
              type="button"
            >
              批量删除
            </button>
            <button
              className="text-sm text-neutral-500 hover:text-white"
              onClick={() => setSelected(new Set())}
              type="button"
            >
              清除选择
            </button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* 照片编辑面板 */}
      {editing && (
        <PhotoEditPanel
          key={editing.id}
          onCancel={() => setEditing(null)}
          photo={editing}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {photosQuery.isPending && <p className="text-neutral-400">加载中…</p>}
      {photos.length === 0 && !photosQuery.isPending && (
        <p className="text-neutral-500">还没有照片，点上面按钮上传。</p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo, index) => {
          const url = thumbUrl(photo);
          const isSelected = selected.has(photo.id);
          const isCover = album?.coverPhotoId === photo.id;
          return (
            <li
              className={`group relative overflow-hidden rounded-xl border ${
                isSelected ? "border-white" : "border-neutral-800"
              }`}
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

              {/* 选择框 */}
              <label className="absolute top-2 left-2 flex cursor-pointer items-center">
                <input
                  checked={isSelected}
                  className="h-4 w-4 accent-white"
                  onChange={() => toggleSelect(photo.id)}
                  type="checkbox"
                />
              </label>

              {isCover && (
                <span className="absolute top-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-black">
                  封面
                </span>
              )}

              {/* 操作按钮 */}
              <div className="absolute inset-x-0 bottom-0 hidden flex-wrap gap-1 bg-black/70 p-2 group-hover:flex">
                <SmallButton
                  disabled={index === 0}
                  onClick={() => move(photo.id, -1)}
                >
                  ↑
                </SmallButton>
                <SmallButton
                  disabled={index === photos.length - 1}
                  onClick={() => move(photo.id, 1)}
                >
                  ↓
                </SmallButton>
                <SmallButton onClick={() => setEditing(photo)}>
                  编辑
                </SmallButton>
                <SmallButton
                  disabled={isCover}
                  onClick={() => coverMutation.mutate(photo.id)}
                >
                  设封面
                </SmallButton>
                <SmallButton
                  disabled={featuredIds.has(photo.id)}
                  onClick={() => addFeaturedMutation.mutate(photo.id)}
                >
                  {featuredIds.has(photo.id) ? "已精选" : "入精选"}
                </SmallButton>
                <SmallButton
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (confirm("确定删除这张照片？")) {
                      deleteMutation.mutate(photo.id);
                    }
                  }}
                >
                  删除
                </SmallButton>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function SmallButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="rounded border border-neutral-600 px-1.5 py-0.5 text-xs text-neutral-200 hover:border-neutral-300 disabled:opacity-40"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function PhotoEditPanel({
  photo,
  onSaved,
  onCancel,
}: {
  photo: AlbumPhotoRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(photo.title ?? "");
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [tags, setTags] = useState(photo.tags.map((tag) => tag.name).join(" "));
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (input: { title: string | null; caption: string | null }) =>
      apiFetch(`/admin/photos/${photo.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onError: (err) => setError(err.message),
  });

  const tagsMutation = useMutation({
    mutationFn: (names: string[]) =>
      apiFetch(`/admin/photos/${photo.id}/tags`, {
        method: "PUT",
        body: JSON.stringify({ names }),
      }),
    onError: (err) => setError(err.message),
  });

  function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const titleValue = title.trim() || null;
    const captionValue = caption.trim() || null;
    const names = tags.split(/\s+/).filter(Boolean);

    Promise.all([
      updateMutation.mutateAsync({
        title: titleValue,
        caption: captionValue,
      }),
      tagsMutation.mutateAsync(names),
    ])
      .then(onSaved)
      .catch(() => setError("保存失败，请重试"));
  }

  return (
    <form
      className="space-y-4 rounded-2xl border border-neutral-800 p-5"
      onSubmit={handleSave}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-300">
          编辑照片 <span className="text-neutral-600">{photo.publicId}</span>
        </h2>
        <button
          className="text-sm text-neutral-500 hover:text-white"
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm text-neutral-400">标题</span>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-neutral-400">标签（空格分隔）</span>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            onChange={(event) => setTags(event.target.value)}
            placeholder="风景 街拍"
            value={tags}
          />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm text-neutral-400">说明</span>
        <textarea
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          maxLength={2000}
          onChange={(event) => setCaption(event.target.value)}
          rows={3}
          value={caption}
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        disabled={updateMutation.isPending || tagsMutation.isPending}
        type="submit"
      >
        保存
      </button>
    </form>
  );
}
