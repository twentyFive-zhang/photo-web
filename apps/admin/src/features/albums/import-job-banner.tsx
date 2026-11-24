import type { ImportJob } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CloudUpload, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { ACTIVE_STATUSES, createImportPollTimer } from "./import-poll";

// 模块级轮询决策器：连续失败计数跨横幅重挂载保持，重挂载不从零开始高频轮询。
const resolvePollInterval = createImportPollTimer();

/**
 * 最近导入任务进度横幅（全局视角，ADR 0006：导入只产照片不进专辑）：
 * 活跃任务每 2s 轮询，终态停止并提示到专辑编辑页挑图。
 * 轮询节奏（含失败退避）集中在 import-poll.ts。
 */
export function ImportJobBanner() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["import-jobs"],
    queryFn: () => apiFetch<ImportJob[]>("/admin/imports?take=5"),
    // 2s 轮询本身就是重试，关掉 react-query 内部重试，
    // 避免接口报错时每个周期 ×3 放大请求量。
    retry: false,
    refetchInterval: (query) => resolvePollInterval(query.state),
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<ImportJob>(`/admin/imports/${jobId}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("失败项已重新排队");
      queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const job = jobsQuery.data?.[0];
  const isActive = job !== undefined && ACTIVE_STATUSES.has(job.status);

  // 全部成功后短暂展示「导入完成」再自动收起；失败态保留（重试/详情要看）
  const [dismissed, setDismissed] = useState(false);
  const jobId = job?.id;
  useEffect(() => {
    if (jobId) setDismissed(false);
  }, [jobId]);
  useEffect(() => {
    if (job?.status !== "SUCCEEDED") return;
    const timer = setTimeout(() => setDismissed(true), 3000);
    return () => clearTimeout(timer);
  }, [job?.status]);

  if (jobsQuery.isPending || !job || dismissed) {
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
          {job.status === "SUCCEEDED" && (
            <span className="text-neutral-500">
              照片已入照片库，用「添加照片」挑进专辑
            </span>
          )}
        </div>
        {failedItems.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              className="text-red-300 hover:text-red-200"
              onClick={() => setExpanded((current) => !current)}
              type="button"
              variant="ghost"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              失败 {failedItems.length} 项
            </Button>
            <Button
              disabled={retryMutation.isPending || isActive}
              onClick={() => retryMutation.mutate(job.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw size={12} />
              重试失败项
            </Button>
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
