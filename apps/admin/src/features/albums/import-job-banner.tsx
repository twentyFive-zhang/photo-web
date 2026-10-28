import type { ImportJob } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CloudUpload, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../lib/api.js";

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

/**
 * 专辑最近导入任务的进度横幅：活跃任务每 2s 轮询，
 * 终态停止并刷新照片列表（导入完成 = 专辑新增照片）。
 */
export function ImportJobBanner({ albumId }: { albumId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["album-imports", albumId],
    queryFn: () =>
      apiFetch<ImportJob[]>(`/admin/albums/${albumId}/imports?take=5`),
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.some((job) => ACTIVE_STATUSES.has(job.status)) ? 2000 : false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<ImportJob>(`/admin/imports/${jobId}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("失败项已重新排队");
      queryClient.invalidateQueries({
        queryKey: ["album-imports", albumId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const job = jobsQuery.data?.[0];
  const isActive = job !== undefined && ACTIVE_STATUSES.has(job.status);

  // 任务到达终态时刷新专辑照片（新导入的照片出现在列表里）
  const status = job?.status;
  useEffect(() => {
    if (status && !ACTIVE_STATUSES.has(status) && status !== "QUEUED") {
      queryClient.invalidateQueries({ queryKey: ["album-photos", albumId] });
    }
  }, [albumId, queryClient, status]);

  if (jobsQuery.isPending || !job) {
    return null;
  }

  const done = job.completed + job.skipped;
  const percent = job.total > 0 ? Math.round((done / job.total) * 100) : 0;
  const failedItems = job.items.filter((item) => item.status === "FAILED");
  const statusText =
    job.status === "QUEUED"
      ? "排队中"
      : job.status === "RUNNING"
        ? "导入中"
        : job.status === "SUCCEEDED"
          ? "导入完成"
          : job.status === "PARTIAL"
            ? "部分失败"
            : "导入失败";

  return (
    <div className="space-y-2 rounded-2xl border border-neutral-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          <CloudUpload className="size-4 text-neutral-500" />
          <span>网盘导入 · {statusText}</span>
          <span className="text-neutral-500">
            {done}/{job.total}
            {job.skipped > 0 && `（跳过重复 ${job.skipped}）`}
          </span>
        </div>
        {failedItems.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1 text-sm text-red-300 hover:text-red-200"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              失败 {failedItems.length} 项
            </button>
            <button
              className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-400 disabled:opacity-40"
              disabled={retryMutation.isPending || isActive}
              onClick={() => retryMutation.mutate(job.id)}
              type="button"
            >
              <RotateCcw size={12} />
              重试失败项
            </button>
          </div>
        )}
      </div>

      {job.status !== "FAILED" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-neutral-300 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {expanded && failedItems.length > 0 && (
        <ul className="space-y-1 text-xs text-red-300">
          {failedItems.map((item) => (
            <li className="truncate" key={item.id}>
              {item.filename}：{item.error ?? "未知错误"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
