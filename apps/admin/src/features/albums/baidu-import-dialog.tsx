import type {
  BaiduConnectionStatus,
  BaiduDirectoryListing,
  BaiduFileEntry,
  CreateBaiduImportInput,
} from "@photo/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  ImageDown,
  Image as ImageIcon,
  Link2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../lib/api";

/** 浏览根目录：2026-06 后创建的应用只能访问 /apps/{应用名}/。 */
const BROWSE_ROOT = "/apps";

/** 连接状态查询（dialog 与外部共用 key，连接跳回后状态即时可见）。 */
export const baiduStatusQuery = {
  queryKey: ["baidu-status"],
  queryFn: () => apiFetch<BaiduConnectionStatus>("/admin/baidu/status"),
};

/**
 * 从百度网盘导入弹窗：连接状态 → 目录浏览（面包屑 + 分页）→
 * 勾选文件/文件夹 → 创建导入任务（文件夹由服务端展开）。
 */
export function BaiduImportDialog({
  albumId,
  onClose,
  onImported,
}: {
  albumId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const statusQuery = useQuery(baiduStatusQuery);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 弹窗遮罩点击关闭，关闭有按钮
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="max-h-[85vh] w-full max-w-2xl space-y-4 overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">从百度网盘导入</h2>
          <button
            aria-label="关闭"
            className="rounded-full border border-neutral-700 p-1.5 text-neutral-400 hover:border-neutral-400 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        {statusQuery.isPending && (
          <p className="text-sm text-neutral-400">加载中…</p>
        )}
        {statusQuery.data && (
          <ImportBody
            albumId={albumId}
            onImported={onImported}
            status={statusQuery.data}
          />
        )}
      </div>
    </div>
  );
}

function ImportBody({
  albumId,
  status,
  onImported,
}: {
  albumId: string;
  status: BaiduConnectionStatus;
  onImported: () => void;
}) {
  // 未配置应用：提示去 .env 配置
  if (!status.appConfigured) {
    return (
      <div className="space-y-2 rounded-xl border border-neutral-800 p-4 text-sm text-neutral-400">
        <p>尚未配置百度网盘应用。</p>
        <p className="text-neutral-500">
          在项目 <code className="text-neutral-300">.env</code> 中填写
          <code className="text-neutral-300"> BAIDU_APP_KEY</code>、
          <code className="text-neutral-300">BAIDU_APP_SECRET</code>、
          <code className="text-neutral-300">BAIDU_REDIRECT_URI</code>
          （百度网盘开放平台「个人使用」应用免审核，申请后几分钟即可用）。
        </p>
      </div>
    );
  }

  // 已配置未授权：引导跳转授权页
  if (!status.connected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-400">
          首次使用需要授权访问你的百度网盘（scope: basic,netdisk）。
          授权仅用于读取网盘文件导入到本站，不会修改网盘内容。
        </p>
        <a
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-neutral-200"
          href="/api/admin/baidu/authorize"
        >
          <Link2 size={15} />
          连接百度网盘
        </a>
      </div>
    );
  }

  return <BaiduBrowser albumId={albumId} onImported={onImported} />;
}

function BaiduBrowser({
  albumId,
  onImported,
}: {
  albumId: string;
  onImported: () => void;
}) {
  const [dir, setDir] = useState(BROWSE_ROOT);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, BaiduFileEntry>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const filesQuery = useQuery({
    queryKey: ["baidu-files", dir, page],
    queryFn: () =>
      apiFetch<BaiduDirectoryListing>(
        `/admin/baidu/files?dir=${encodeURIComponent(dir)}&page=${page}`,
      ),
  });

  const importMutation = useMutation({
    mutationFn: (input: CreateBaiduImportInput) =>
      apiFetch<unknown>("/admin/imports/baidu", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      toast.success("导入任务已创建，完成后照片会出现在专辑中");
      onImported();
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  const entries = filesQuery.data?.entries ?? [];
  const selectedFiles = [...selected.values()].filter((entry) => !entry.isDir);
  const selectedDirs = [...selected.values()].filter((entry) => entry.isDir);

  function navigate(target: string) {
    setDir(target);
    setPage(1);
  }

  function toggle(entry: BaiduFileEntry) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(entry.fsId)) {
        next.delete(entry.fsId);
      } else {
        next.set(entry.fsId, entry);
      }
      return next;
    });
  }

  /** 确认导入：把勾选条目交给服务端展开（文件夹递归、图片过滤、上限校验）。 */
  function startImport() {
    setError(null);
    importMutation.mutate({
      albumId,
      entries: [...selected.values()].map((entry) => ({
        fsId: entry.fsId,
        path: entry.path,
        serverFilename: entry.serverFilename,
        isDir: entry.isDir,
        size: entry.size,
      })),
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        照片需位于网盘「我的应用数据」目录（即{" "}
        <code className="text-neutral-300">/apps/</code> 开头）。
        可勾选文件或整个文件夹，文件夹会被完整导入（仅图片，≤500 张/次）。
      </p>

      <Breadcrumb dir={dir} onNavigate={navigate} />

      {filesQuery.isPending && (
        <p className="text-sm text-neutral-400">加载中…</p>
      )}
      {filesQuery.isError && (
        <p className="text-sm text-red-400">{filesQuery.error.message}</p>
      )}
      {!filesQuery.isPending && entries.length === 0 && (
        <p className="text-sm text-neutral-500">
          此目录为空。把照片上传到网盘「我的应用数据/{`<应用名>`}」后重试。
        </p>
      )}

      <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
        {entries.map((entry) => {
          const isSelected = selected.has(entry.fsId);
          return (
            <li className="flex items-center gap-3 px-3 py-2" key={entry.fsId}>
              <input
                checked={isSelected}
                className="h-4 w-4 accent-white"
                onChange={() => toggle(entry)}
                type="checkbox"
              />
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-neutral-200 hover:text-white"
                onClick={() => {
                  if (entry.isDir) {
                    navigate(entry.path);
                  } else {
                    toggle(entry);
                  }
                }}
                type="button"
              >
                {entry.isDir ? (
                  isSelected ? (
                    <FolderOpen className="size-4 shrink-0 text-neutral-400" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-neutral-400" />
                  )
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-neutral-600" />
                )}
                <span className="truncate">{entry.serverFilename}</span>
                {!entry.isDir && (
                  <span className="shrink-0 text-xs text-neutral-600">
                    {formatBytes(entry.size)}
                  </span>
                )}
              </button>
              {entry.isDir && (
                <ChevronRight className="size-4 shrink-0 text-neutral-600" />
              )}
            </li>
          );
        })}
      </ul>

      {(filesQuery.data?.hasMore || page > 1) && (
        <div className="flex items-center justify-between text-sm text-neutral-400">
          <button
            className="rounded-full border border-neutral-700 px-3 py-1 hover:border-neutral-400 disabled:opacity-40"
            disabled={page <= 1 || filesQuery.isPending}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            上一页
          </button>
          <span>第 {page} 页</span>
          <button
            className="rounded-full border border-neutral-700 px-3 py-1 hover:border-neutral-400 disabled:opacity-40"
            disabled={!filesQuery.data?.hasMore || filesQuery.isPending}
            onClick={() => setPage((current) => current + 1)}
            type="button"
          >
            下一页
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <p className="text-sm text-neutral-400">
          已选 {selectedFiles.length} 个文件、{selectedDirs.length} 个文件夹
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {selected.size > 0 && (
          <button
            className="text-sm text-neutral-500 hover:text-white"
            onClick={() => setSelected(new Map())}
            type="button"
          >
            清除选择
          </button>
        )}
        <button
          className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={selected.size === 0 || importMutation.isPending}
          onClick={startImport}
          type="button"
        >
          <ImageDown size={15} />
          {importMutation.isPending ? "创建中…" : "开始导入"}
        </button>
      </div>
    </div>
  );
}

/** 面包屑：/apps/应用名/子目录 → 点击跳转；/apps 根不可越出。 */
function Breadcrumb({
  dir,
  onNavigate,
}: {
  dir: string;
  onNavigate: (dir: string) => void;
}) {
  const parts = dir.split("/").filter(Boolean);
  const crumbs = [{ label: "我的应用数据", path: BROWSE_ROOT }];
  let acc = BROWSE_ROOT;
  for (const part of parts.slice(1)) {
    acc = `${acc}/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-neutral-400">
      {crumbs.map((crumb, index) => (
        <span className="flex items-center gap-1" key={crumb.path}>
          {index > 0 && <ChevronRight className="size-3 text-neutral-600" />}
          <button
            className={
              index === crumbs.length - 1
                ? "font-medium text-neutral-200"
                : "hover:text-white"
            }
            onClick={() => onNavigate(crumb.path)}
            type="button"
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
