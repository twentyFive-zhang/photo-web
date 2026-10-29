import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Album,
  type CreateAlbumInput,
  createAlbumInputSchema,
} from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FolderOpen, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
            <li key={album.id}>
              <Link
                className="block rounded-2xl border border-neutral-800 p-5 transition-colors hover:border-neutral-500"
                params={{ albumId: album.id }}
                to="/albums/$albumId"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{album.title}</span>
                  <Badge
                    variant={
                      album.visibility === "PUBLIC" ? "success" : "default"
                    }
                  >
                    {album.visibility === "PUBLIC" ? "公开" : "仅链接"}
                  </Badge>
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
