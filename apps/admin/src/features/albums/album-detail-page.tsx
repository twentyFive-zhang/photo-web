import { zodResolver } from "@hookform/resolvers/zod";
import type { Album } from "@photo/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  CloudDownload,
  CloudUpload,
  Crown,
  EyeOff,
  Globe,
  ImageMinus,
  ImagePlus,
  Images,
  Pencil,
  QrCode,
  RefreshCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, mediaUrl } from "@/lib/api";
import {
  AdminShell,
  type AlbumPhotoRow,
  useFeaturedIds,
  useInvalidateAlbum,
} from "@/lib/shell";
import { BaiduImportDialog } from "./baidu-import-dialog";
import { ImportJobBanner } from "./import-job-banner";
import { PhotoPickerDialog } from "./photo-picker-dialog";
import { QrDialog } from "./qr-dialog";

const photoEditSchema = z.object({
  title: z.string().max(200),
  caption: z.string().max(2000),
  tags: z.string(),
});
type PhotoEditValues = z.infer<typeof photoEditSchema>;

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
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AlbumPhotoRow | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchRemoveOpen, setBatchRemoveOpen] = useState(false);
  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null);
  const [deleteAlbumOpen, setDeleteAlbumOpen] = useState(false);

  const invalidate = useInvalidateAlbum(albumId);

  const albumQuery = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => apiFetch<Album>(`/admin/albums/${albumId}`),
  });

  const photosQuery = useQuery({
    queryKey: ["album-photos", albumId],
    queryFn: () => apiFetch<AlbumPhotoRow[]>(`/admin/albums/${albumId}/photos`),
  });

  const featuredIds = useFeaturedIds();

  const fail = (err: Error) => {
    setError(err.message);
    toast.error(err.message);
  };

  /** 上传到照片库（不进专辑；上传后用「添加照片」挑进专辑）。 */
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
      toast.success(`已上传 ${count} 张到照片库（用「添加照片」挑进本专辑）`);
      invalidate();
    },
    onError: fail,
  });

  /** 删除照片 = 移除索引（网盘文件原地保留，回到待导入状态）。 */
  const deleteMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<void>(`/admin/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("照片已删除，网盘文件保留原位");
      invalidate();
    },
    onError: fail,
  });

  /** 删除专辑 = 站内下架（成员关系解除，照片保留在照片库）。 */
  const deleteAlbumMutation = useMutation({
    mutationFn: () =>
      apiFetch<void>(`/admin/albums/${albumId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("专辑已删除，照片保留在照片库");
      invalidate();
      navigate({ to: "/albums" });
    },
    onError: fail,
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch<{ deleted: number }>("/admin/photos/batch-delete", {
        method: "POST",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: ({ deleted }) => {
      toast.success(`已删除 ${deleted} 张照片，网盘文件保留原位`);
      setSelected(new Set());
      invalidate();
    },
    onError: fail,
  });

  /** 批量移出专辑：只拆成员关系，照片保留在照片库。 */
  const batchRemoveMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch<void>(`/admin/albums/${albumId}/photos/remove`, {
        method: "POST",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: () => {
      toast.success("已移出专辑（照片保留在照片库）");
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
    onSuccess: () => {
      toast.success("排序已保存");
      invalidate();
    },
    onError: fail,
  });

  const coverMutation = useMutation({
    mutationFn: (coverPhotoId: string) =>
      apiFetch<Album>(`/admin/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify({ coverPhotoId }),
      }),
    onSuccess: () => {
      toast.success("封面已设置");
      invalidate();
    },
    onError: fail,
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: "PUBLIC" | "UNLISTED") =>
      apiFetch<Album>(`/admin/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
    onSuccess: (album) => {
      toast.success(
        album.visibility === "PUBLIC" ? "专辑已公开" : "专辑已设为仅链接可见",
      );
      invalidate();
    },
    onError: fail,
  });

  const addFeaturedMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch("/admin/featured", {
        method: "PUT",
        body: JSON.stringify({ photoIds: [...featuredIds, photoId] }),
      }),
    onSuccess: () => {
      toast.success("已加入精选");
      invalidate();
    },
    onError: fail,
  });

  const photos = photosQuery.data ?? [];
  const memberIds = useMemo(
    () => new Set(photos.map((photo) => photo.id)),
    [photos],
  );

  /** 按专辑补推未同步照片（连接网盘前上传或推送失败的存量）。 */
  const pushAlbumMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ queued: number }>(`/admin/netdisk/albums/${albumId}/push`, {
        method: "POST",
      }),
    onSuccess: ({ queued }) => {
      toast.success(
        queued > 0 ? `已入队同步 ${queued} 张照片` : "本专辑照片都已同步",
      );
    },
    onError: fail,
  });

  /** 从网盘重建展示变体（本地 thumb/display 丢失或损坏时修复，ADR 0005）。 */
  const rebuildMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch(`/admin/photos/${photoId}/rebuild-renditions`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("已从网盘重建变体");
      invalidate();
    },
    onError: fail,
  });

  /** 灯箱数据：DISPLAY 大图（1600px，无则 null，点击时跳过打开）。 */
  const lightboxPhotos = photos.map((photo) => {
    const display = photo.renditions.find((r) => r.variant === "DISPLAY");
    return {
      url: display ? mediaUrl(display.key) : null,
      title: photo.title,
      caption: photo.caption,
    };
  });

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
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          <div className="flex shrink-0 items-center gap-2">
            <Button
              onClick={() => setShowQr(true)}
              type="button"
              variant="outline"
            >
              <QrCode size={15} />
              二维码
            </Button>
            <Button
              disabled={visibilityMutation.isPending}
              onClick={() =>
                visibilityMutation.mutate(
                  album.visibility === "PUBLIC" ? "UNLISTED" : "PUBLIC",
                )
              }
              type="button"
              variant={album.visibility === "PUBLIC" ? "outline" : "default"}
            >
              {album.visibility === "PUBLIC" ? (
                <>
                  <EyeOff size={15} />
                  取消公开
                </>
              ) : (
                <>
                  <Globe size={15} />
                  发布（公开）
                </>
              )}
            </Button>
            <Button
              disabled={deleteAlbumMutation.isPending}
              onClick={() => setDeleteAlbumOpen(true)}
              type="button"
              variant="ghost"
            >
              <Trash2 size={15} />
              删除专辑
            </Button>
          </div>
        )}
      </div>

      {/* 最近导入任务进度横幅（导入只入照片库，完成后到这里挑图） */}
      <ImportJobBanner />

      {/* 上传 + 挑图 + 批量操作工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => setShowPicker(true)}
          type="button"
          variant="default"
        >
          <Images size={15} />
          添加照片
        </Button>

        <Button asChild className="border-dashed" variant="outline">
          <label className="cursor-pointer">
            <ImagePlus size={15} />
            {uploadMutation.isPending ? "上传中…" : "上传到照片库"}
            <input
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              multiple
              onChange={handleFilesSelected}
              ref={fileInputRef}
              type="file"
            />
          </label>
        </Button>

        <Button
          className="border-dashed"
          onClick={() => setShowImport(true)}
          type="button"
          variant="outline"
        >
          <CloudDownload size={15} />
          从网盘导入
        </Button>

        <Button
          className="border-dashed"
          disabled={pushAlbumMutation.isPending}
          onClick={() => pushAlbumMutation.mutate()}
          type="button"
          variant="outline"
        >
          <CloudUpload size={15} />
          {pushAlbumMutation.isPending ? "入队中…" : "同步到网盘"}
        </Button>

        {selected.size > 0 && (
          <>
            <span className="text-sm text-neutral-400">
              已选 {selected.size} 张
            </span>
            <Button
              disabled={batchRemoveMutation.isPending}
              onClick={() => setBatchRemoveOpen(true)}
              type="button"
              variant="outline"
            >
              <ImageMinus size={15} />
              移出专辑
            </Button>
            <Button
              disabled={batchDeleteMutation.isPending}
              onClick={() => setBatchDeleteOpen(true)}
              type="button"
              variant="destructive"
            >
              <Trash2 size={15} />
              删除照片
            </Button>
            <Button
              onClick={() => setSelected(new Set())}
              type="button"
              variant="ghost"
            >
              <X size={14} />
              清除选择
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {album && (
        <QrDialog album={album} onOpenChange={setShowQr} open={showQr} />
      )}

      <BaiduImportDialog
        onImported={() => {
          setShowImport(false);
          invalidate();
        }}
        onOpenChange={setShowImport}
        open={showImport}
      />

      <PhotoPickerDialog
        albumId={albumId}
        memberIds={memberIds}
        onChanged={invalidate}
        onOpenChange={setShowPicker}
        open={showPicker}
      />

      <ConfirmDialog
        danger
        confirmText="删除"
        description={`将删除选中的 ${selected.size} 张照片的站内索引，网盘文件原地保留并回到待导入清单。`}
        onConfirm={() => batchDeleteMutation.mutateAsync([...selected])}
        onOpenChange={setBatchDeleteOpen}
        open={batchDeleteOpen}
        title="删除照片"
      />

      <ConfirmDialog
        confirmText="移出"
        description={`将选中的 ${selected.size} 张照片移出本专辑（只拆成员关系，照片保留在照片库）。`}
        onConfirm={() => batchRemoveMutation.mutateAsync([...selected])}
        onOpenChange={setBatchRemoveOpen}
        open={batchRemoveOpen}
        title="移出专辑"
      />

      {deletePhotoId !== null && (
        <ConfirmDialog
          danger
          confirmText="删除"
          description="将删除这张照片的站内索引，网盘文件原地保留并回到待导入清单；重新导入即可恢复。"
          onConfirm={() => deleteMutation.mutateAsync(deletePhotoId)}
          onOpenChange={(open) => {
            if (!open) setDeletePhotoId(null);
          }}
          open
          title="删除照片"
        />
      )}

      {album && (
        <ConfirmDialog
          danger
          confirmText="删除"
          description={`专辑与分享链接将一并下架，成员关系解除；${album.photoCount} 张照片保留在照片库，网盘文件不动，不可恢复专辑本身。`}
          onConfirm={() => deleteAlbumMutation.mutateAsync()}
          onOpenChange={setDeleteAlbumOpen}
          open={deleteAlbumOpen}
          title={`删除专辑「${album.title}」`}
        />
      )}

      {/* 大图灯箱 */}
      {viewing !== null && (
        <PhotoLightbox
          index={viewing}
          photos={lightboxPhotos}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}

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
        <p className="text-neutral-500">
          还没有成员照片，点「添加照片」从照片库挑图。
        </p>
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
                <button
                  className="block w-full cursor-zoom-in"
                  onClick={() => {
                    if (lightboxPhotos[index].url) setViewing(index);
                  }}
                  type="button"
                >
                  {/* biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化 */}
                  <img
                    alt={photo.title ?? "照片"}
                    className="aspect-square w-full object-cover"
                    src={url}
                  />
                </button>
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
                <Badge className="absolute top-2 right-2" variant="secondary">
                  封面
                </Badge>
              )}

              {/* 操作按钮：手机无常显 hover，小屏直接展示 */}
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-black/70 p-2 sm:hidden sm:group-hover:flex">
                <Button
                  aria-label="上移"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={index === 0}
                  onClick={() => move(photo.id, -1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronUp size={12} />
                </Button>
                <Button
                  aria-label="下移"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={index === photos.length - 1}
                  onClick={() => move(photo.id, 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronDown size={12} />
                </Button>
                <Button
                  aria-label="编辑"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  onClick={() => setEditing(photo)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  aria-label="设封面"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={isCover}
                  onClick={() => coverMutation.mutate(photo.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Crown size={12} />
                </Button>
                <Button
                  aria-label="入精选"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={featuredIds.has(photo.id)}
                  onClick={() => addFeaturedMutation.mutate(photo.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Star size={12} />
                </Button>
                <Button
                  aria-label="从网盘重建变体"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={rebuildMutation.isPending}
                  onClick={() => rebuildMutation.mutate(photo.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCcw size={12} />
                </Button>
                <Button
                  aria-label="移出专辑"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={batchRemoveMutation.isPending}
                  onClick={() => batchRemoveMutation.mutate([photo.id])}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ImageMinus size={12} />
                </Button>
                <Button
                  aria-label="删除"
                  className="rounded border border-neutral-600 px-1.5 py-0.5"
                  disabled={deleteMutation.isPending}
                  onClick={() => setDeletePhotoId(photo.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
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
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<PhotoEditValues>({
    resolver: zodResolver(photoEditSchema),
    defaultValues: {
      title: photo.title ?? "",
      caption: photo.caption ?? "",
      tags: photo.tags.map((tag) => tag.name).join(" "),
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string | null; caption: string | null }) =>
      apiFetch(`/admin/photos/${photo.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
  });

  const tagsMutation = useMutation({
    mutationFn: (names: string[]) =>
      apiFetch(`/admin/photos/${photo.id}/tags`, {
        method: "PUT",
        body: JSON.stringify({ names }),
      }),
  });

  const saving = updateMutation.isPending || tagsMutation.isPending;

  return (
    <Form {...form}>
      <form
        className="space-y-4 rounded-2xl border border-neutral-800 p-5"
        onSubmit={form.handleSubmit(async (values) => {
          setServerError(null);
          try {
            await Promise.all([
              updateMutation.mutateAsync({
                title: values.title.trim() || null,
                caption: values.caption.trim() || null,
              }),
              tagsMutation.mutateAsync(
                values.tags.split(/\s+/).filter(Boolean),
              ),
            ]);
            toast.success("照片已保存");
            onSaved();
          } catch {
            setServerError("保存失败，请重试");
            toast.error("保存失败，请重试");
          }
        })}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">
            编辑照片 <span className="text-neutral-600">{photo.publicId}</span>
          </h2>
          <Button onClick={onCancel} type="button" variant="ghost">
            取消
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>标题</FormLabel>
                <FormControl>
                  <Input maxLength={200} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tags"
            render={({ field }) => (
              <FormItem>
                <FormLabel>标签（空格分隔）</FormLabel>
                <FormControl>
                  <Input placeholder="风景 街拍" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="caption"
          render={({ field }) => (
            <FormItem>
              <FormLabel>说明</FormLabel>
              <FormControl>
                <Textarea maxLength={2000} rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {serverError && <p className="text-sm text-red-400">{serverError}</p>}
        <Button disabled={saving} type="submit">
          保存
        </Button>
      </form>
    </Form>
  );
}
