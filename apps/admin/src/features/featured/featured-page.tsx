import type { FeaturedItem } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch, mediaUrl } from "../../lib/api.js";
import { AdminShell } from "../../lib/shell.js";

export function FeaturedPage() {
  return (
    <AdminShell>
      <FeaturedList />
    </AdminShell>
  );
}

function FeaturedList() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const featuredQuery = useQuery({
    queryKey: ["featured"],
    queryFn: () => apiFetch<FeaturedItem[]>("/admin/featured"),
  });

  const fail = (err: Error) => setError(err.message);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["featured"] });

  /** 全量替换顺序（精选 set API 即重排）。 */
  const reorderMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch("/admin/featured", {
        method: "PUT",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: invalidate,
    onError: fail,
  });

  const removeMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch(`/admin/featured/${photoId}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: fail,
  });

  const items = featuredQuery.data ?? [];

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    reorderMutation.mutate(next.map((item) => item.photoId));
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-medium">精选</h1>
        <p className="text-sm text-neutral-500">
          顺序即前台展示顺序；在专辑页把照片"入精选"后在这里重排。
        </p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {featuredQuery.isPending && <p className="text-neutral-400">加载中…</p>}
      {items.length === 0 && !featuredQuery.isPending && (
        <p className="text-neutral-500">
          还没有精选照片。到专辑页选中照片点"入精选"。
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            className="flex items-center gap-4 rounded-xl border border-neutral-800 p-3"
            key={item.photoId}
          >
            <span className="w-6 text-center text-sm text-neutral-500">
              {index + 1}
            </span>
            {item.thumbKey ? (
              // biome-ignore lint/performance/noImgElement: 缩略图走本地 /media，不走 next/image 优化
              <img
                alt={item.photo.title ?? "精选照片"}
                className="h-16 w-16 rounded-lg object-cover"
                src={mediaUrl(item.thumbKey)}
              />
            ) : (
              <div className="h-16 w-16 rounded-lg bg-neutral-900" />
            )}
            <div className="flex-1">
              <p className="text-sm text-neutral-200">
                {item.photo.title ?? item.photo.publicId}
              </p>
            </div>
            <button
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-neutral-400 disabled:opacity-40"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              type="button"
            >
              ↑
            </button>
            <button
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-neutral-400 disabled:opacity-40"
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
              type="button"
            >
              ↓
            </button>
            <button
              className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:border-red-500"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate(item.photoId)}
              type="button"
            >
              移除
            </button>
          </li>
        ))}
      </ul>

      <Link className="text-sm text-neutral-500 hover:text-white" to="/albums">
        ← 回专辑
      </Link>
    </main>
  );
}
