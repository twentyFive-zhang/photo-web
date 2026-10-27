import type { Album } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { AdminShell } from "../../lib/shell.js";

export function AlbumsPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => apiFetch<Album[]>("/admin/albums"),
  });

  const createMutation = useMutation({
    mutationFn: (input: { title: string }) =>
      apiFetch<Album>("/admin/albums", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["albums"] });
    },
    onError: (err) => setError(err.message),
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    createMutation.mutate({ title: title.trim() });
  }

  return (
    <AdminShell>
      <main className="mx-auto min-h-screen max-w-4xl space-y-8 p-8">
        <h1 className="text-2xl font-medium">专辑</h1>

        <form className="flex gap-2" onSubmit={handleCreate}>
          <input
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="新专辑标题"
            value={title}
          />
          <button
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            disabled={createMutation.isPending}
            type="submit"
          >
            创建
          </button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}

        {albumsQuery.isPending && <p className="text-neutral-400">加载中…</p>}
        {albumsQuery.data?.length === 0 && (
          <p className="text-neutral-500">还没有专辑，先创建一个。</p>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {albumsQuery.data?.map((album) => (
            <li key={album.id}>
              <Link
                className="block rounded-2xl border border-neutral-800 p-5 transition-colors hover:border-neutral-500"
                params={{ albumId: album.id }}
                to="/albums/$albumId"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{album.title}</span>
                  <span
                    className={
                      album.visibility === "PUBLIC"
                        ? "rounded-full bg-green-900/60 px-2 py-0.5 text-xs text-green-300"
                        : "rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400"
                    }
                  >
                    {album.visibility === "PUBLIC" ? "公开" : "仅链接"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-neutral-500">
                  {album.photoCount} 张照片 · {album.publicId}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </AdminShell>
  );
}
