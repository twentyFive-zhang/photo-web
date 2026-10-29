import type { FeaturedItem } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, mediaUrl } from "@/lib/api";
import { AdminShell } from "@/lib/shell";

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, FeaturedItem>();

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

  const fail = (err: Error) => {
    setError(err.message);
    toast.error(err.message);
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["featured"] });

  /** 全量替换顺序（精选 set API 即重排）。 */
  const reorderMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      apiFetch("/admin/featured", {
        method: "PUT",
        body: JSON.stringify({ photoIds }),
      }),
    onSuccess: () => {
      toast.success("精选排序已保存");
      invalidate();
    },
    onError: fail,
  });

  const removeMutation = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch(`/admin/featured/${photoId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("已移出精选");
      invalidate();
    },
    onError: fail,
  });

  const items = featuredQuery.data ?? EMPTY_FEATURED;

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    reorderMutation.mutate(next.map((item) => item.photoId));
  }

  const columns = helper.columns([
    helper.display({
      id: "index",
      header: "#",
      cell: ({ row }) => (
        <span className="text-neutral-500">{row.index + 1}</span>
      ),
    }),
    helper.display({
      id: "thumb",
      header: "预览",
      cell: ({ row }) =>
        row.original.thumbKey ? (
          // biome-ignore lint/performance/noImgElement: 缩略图走本地 /media，不走 next/image 优化
          <img
            alt={row.original.photo.title ?? "精选照片"}
            className="h-16 w-16 rounded-lg object-cover"
            src={mediaUrl(row.original.thumbKey)}
          />
        ) : (
          <div className="h-16 w-16 rounded-lg bg-neutral-900" />
        ),
    }),
    helper.accessor((row) => row.photo.title ?? row.photo.publicId, {
      id: "title",
      header: "标题",
      cell: (info) => (
        <span className="text-neutral-200">{info.getValue()}</span>
      ),
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">操作</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button
            aria-label="上移"
            disabled={row.index === 0}
            onClick={() => move(row.index, -1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronUp size={12} />
          </Button>
          <Button
            aria-label="下移"
            disabled={row.index === items.length - 1}
            onClick={() => move(row.index, 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronDown size={12} />
          </Button>
          <Button
            aria-label="移出精选"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate(row.original.photoId)}
            size="icon-sm"
            type="button"
            variant="destructive"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ),
    }),
  ]);

  const table = useTable({
    features,
    columns,
    data: items,
  });

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-medium">
          <Star size={22} />
          精选
        </h1>
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

      {items.length > 0 && (
        <div className="rounded-xl border border-neutral-800">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Button asChild variant="ghost">
        <Link to="/albums">← 回专辑</Link>
      </Button>
    </main>
  );
}

/** 稳定空数组，避免 `?? []` 每渲染新建引用打乱 row model。 */
const EMPTY_FEATURED: FeaturedItem[] = [];
