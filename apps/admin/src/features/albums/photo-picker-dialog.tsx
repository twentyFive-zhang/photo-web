import type { Photo } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, mediaUrl } from "@/lib/api";

function thumbUrl(photo: Photo): string | null {
  const thumb = photo.renditions.find((r) => r.variant === "THUMB");
  return thumb ? mediaUrl(thumb.key) : null;
}

/**
 * 从照片库挑图进专辑（ADR 0006 收编两段式第二步）：
 * 全量照片列表（新照片在前）+ 按标题搜索 + 勾选追加；已在专辑内的照片
 * 打勾不可再选。支持弹窗内直接上传本机照片到照片库。
 */
export function PhotoPickerDialog({
  albumId,
  memberIds,
  open,
  onOpenChange,
  onChanged,
}: {
  albumId: string;
  /** 当前专辑成员 photoId 集合（打勾展示 + 提交后刷新）。 */
  memberIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photosQuery = useQuery({
    queryKey: ["photos"],
    queryFn: () => apiFetch<Photo[]>("/admin/photos"),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch<void>(`/admin/albums/${albumId}/photos`, {
        method: "POST",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: (_data, photoIds) => {
      toast.success(`已添加 ${photoIds.length} 张照片`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["photos"] });
      onChanged();
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        await apiFetch("/admin/photos/upload", {
          method: "POST",
          body: form,
        });
      }
      return files.length;
    },
    onSuccess: (count) => {
      toast.success(`已上传 ${count} 张到照片库`);
      queryClient.invalidateQueries({ queryKey: ["photos"] });
      onChanged();
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  const photos = photosQuery.data ?? [];
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return photos;
    return photos.filter(
      (photo) =>
        (photo.title ?? "").toLowerCase().includes(kw) ||
        photo.publicId.toLowerCase().includes(kw),
    );
  }, [photos, keyword]);

  const selectedAddable = [...selected].filter((id) => !memberIds.has(id));

  function toggle(photoId: string) {
    if (memberIds.has(photoId)) return;
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

  function handleFilesSelected(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (list.length > 0) uploadMutation.mutate(list);
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) setSelected(new Set());
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>从照片库挑图</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search
              className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-500"
              size={14}
            />
            <Input
              className="pl-8"
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按标题或 publicId 搜索"
              value={keyword}
            />
          </div>
          <Button
            className="border-dashed"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <ImagePlus size={15} />
            {uploadMutation.isPending ? "上传中…" : "上传到照片库"}
          </Button>
          <input
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            multiple
            onChange={(event) => handleFilesSelected(event.target.files)}
            ref={fileInputRef}
            type="file"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-800">
          {photosQuery.isPending ? (
            <p className="flex items-center gap-2 p-4 text-sm text-neutral-400">
              <Loader2 className="animate-spin" size={14} />
              加载中…
            </p>
          ) : photos.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">
              照片库还是空的——先「上传到照片库」或从网盘导入。
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">没有匹配的照片。</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 p-2 sm:grid-cols-4">
              {filtered.map((photo) => {
                const isMember = memberIds.has(photo.id);
                const isSelected = selected.has(photo.id);
                const url = thumbUrl(photo);
                return (
                  <li key={photo.id}>
                    <button
                      className={`group relative block w-full overflow-hidden rounded-lg border ${
                        isMember
                          ? "border-neutral-700 opacity-50"
                          : isSelected
                            ? "border-white"
                            : "border-neutral-800 hover:border-neutral-500"
                      }`}
                      disabled={isMember}
                      onClick={() => toggle(photo.id)}
                      type="button"
                    >
                      {url ? (
                        // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                        <img
                          alt={photo.title ?? "照片"}
                          className="aspect-square w-full object-cover"
                          src={url}
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center text-xs text-neutral-600">
                          无预览
                        </div>
                      )}
                      {isMember && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Check
                            className="size-5 text-neutral-300"
                            size={20}
                          />
                        </span>
                      )}
                      {photo.title && (
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-0.5 text-left text-[11px] text-neutral-300">
                          {photo.title}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-neutral-400">
            已选 {selectedAddable.length} 张
            {memberIds.size > 0 && ` · 专辑内已有 ${memberIds.size} 张`}
          </span>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            <X size={14} />
            关闭
          </Button>
          <Button
            disabled={selectedAddable.length === 0 || addMutation.isPending}
            onClick={() => addMutation.mutate(selectedAddable)}
            type="button"
          >
            <Check size={15} />
            添加到专辑
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
