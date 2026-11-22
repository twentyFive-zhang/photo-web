import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Album,
  type CreateAlbumInput,
  createAlbumInputSchema,
} from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { AdminShell } from "@/lib/shell";

export function AlbumsPage() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Album | null>(null);

  const form = useForm<CreateAlbumInput>({
    resolver: zodResolver(createAlbumInputSchema),
    defaultValues: { title: "" },
  });

  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => apiFetch<Album[]>("/admin/albums"),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateAlbumInput) =>
      apiFetch<Album>("/admin/albums", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (album) => {
      form.reset({ title: "" });
      toast.success(`专辑「${album.title}」已创建`);
      queryClient.invalidateQueries({ queryKey: ["albums"] });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (albumId: string) =>
      apiFetch<void>(`/admin/albums/${albumId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("专辑已删除，网盘文件保留并归档");
      queryClient.invalidateQueries({ queryKey: ["albums"] });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  return (
    <AdminShell>
      <main className="mx-auto min-h-screen max-w-4xl space-y-8 p-4 sm:p-8">
        <h1 className="flex items-center gap-2 text-2xl font-medium">
          <FolderOpen size={22} />
          专辑
        </h1>

        <Form {...form}>
          <form
            className="flex gap-2"
            onSubmit={form.handleSubmit((values) =>
              createMutation.mutate(values),
            )}
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      maxLength={200}
                      placeholder="新专辑标题"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button disabled={createMutation.isPending} type="submit">
              <Plus size={15} />
              创建
            </Button>
          </form>
        </Form>

        {albumsQuery.isPending && <p className="text-neutral-400">加载中…</p>}
        {albumsQuery.data?.length === 0 && (
          <p className="text-neutral-500">还没有专辑，先创建一个。</p>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {albumsQuery.data?.map((album) => (
            <li
              className="group relative rounded-2xl border border-neutral-800 p-5 transition-colors hover:border-neutral-500"
              key={album.id}
            >
              {/* 拉伸链接：整卡可点跳详情；操作区浮在其上（relative z-10 抬升
                  绘制序，否则删除按钮被链接盖住点不到）。容器整体
                  pointer-events-none，仅删除按钮 auto——标题/角标点击仍穿透
                  到链接跳详情 */}
              <Link
                aria-label={`打开专辑 ${album.title}`}
                className="absolute inset-0 rounded-2xl"
                params={{ albumId: album.id }}
                to="/albums/$albumId"
              />
              <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
                <span className="truncate font-medium">{album.title}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge
                    variant={
                      album.visibility === "PUBLIC" ? "success" : "default"
                    }
                  >
                    {album.visibility === "PUBLIC" ? "公开" : "仅链接"}
                  </Badge>
                  <Button
                    aria-label={`删除专辑 ${album.title}`}
                    className="pointer-events-auto"
                    disabled={deleteMutation.isPending}
                    onClick={() => setDeleteTarget(album)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
              <p className="pointer-events-none mt-2 text-sm text-neutral-500">
                {album.photoCount} 张照片 · {album.publicId}
              </p>
            </li>
          ))}
        </ul>

        {deleteTarget !== null && (
          <ConfirmDialog
            danger
            confirmText="删除"
            description={`将移除 ${deleteTarget.photoCount} 张照片的站内记录，网盘文件保留并归档；专辑与分享链接一并下架，不可恢复。`}
            onConfirm={() => deleteMutation.mutateAsync(deleteTarget.id)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            open
            title={`删除专辑「${deleteTarget.title}」`}
          />
        )}
      </main>
    </AdminShell>
  );
}
