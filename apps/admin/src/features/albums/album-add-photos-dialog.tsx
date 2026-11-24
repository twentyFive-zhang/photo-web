import type {
  BaiduConnectionStatus,
  BaiduFileEntry,
  CreateBaiduImportInput,
  Photo,
} from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CloudDownload,
  HardDriveUpload,
  Images,
  Link2,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { baiduStatusQuery } from "@/features/netdisk/baidu-status";
import {
  NetdiskTree,
  useNetdiskTreeNodes,
} from "@/features/netdisk/netdisk-tree";
import { apiFetch } from "@/lib/api";
import { PhotoPickerGrid } from "./photo-picker-grid";

/**
 * 专辑「添加照片」弹窗（ADR 0007 一步挂专辑）：三个来源 tab，终态一致——
 * 照片存在 + 纳入当前专辑。
 * - 照片库：勾选已有照片（PhotoPickerGrid），确认后写入成员关系；
 * - 本机上传：多选文件逐张走现有上传管线，成功后逐张纳入，失败行内重试；
 * - 网盘选：共享网盘树（仅浏览 + 勾选图片），提交走导入管线并附带
 *   albumId，导入异步完成后自动纳入（不占位卡片）。
 */
export function AlbumAddPhotosDialog({
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
  const [tab, setTab] = useState<"library" | "upload" | "netdisk">("library");

  // 网盘选 tab 的连接状态（tab 级查询；未连接时展示引导）
  const statusQuery = useQuery({
    ...baiduStatusQuery,
    enabled: open,
  });

  function close() {
    onOpenChange(false);
  }

  const tabs = [
    { icon: Images, id: "library" as const, label: "照片库" },
    { icon: HardDriveUpload, id: "upload" as const, label: "本机上传" },
    { icon: CloudDownload, id: "netdisk" as const, label: "网盘选" },
  ];

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) setTab("library");
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>添加照片</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border border-neutral-800 p-1">
          {tabs.map(({ icon: Icon, id, label }) => (
            <button
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                tab === id
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
              key={id}
              onClick={() => setTab(id)}
              type="button"
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {tab === "library" && (
          <LibraryTab
            albumId={albumId}
            memberIds={memberIds}
            onChanged={onChanged}
            onClose={close}
            open={open}
          />
        )}
        {/* 本机上传 tab 常驻挂载（仅 CSS 隐藏）：切 tab 不丢逐行状态与失败重试 */}
        <div className={tab === "upload" ? "contents" : "hidden"}>
          <UploadTab albumId={albumId} onChanged={onChanged} onClose={close} />
        </div>
        {tab === "netdisk" && (
          <NetdiskTab
            albumId={albumId}
            onClose={close}
            status={statusQuery.data}
            statusPending={statusQuery.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 照片库 tab：勾选已有照片 → 写入成员关系（原挑图弹窗的确认逻辑）。 */
function LibraryTab({
  albumId,
  memberIds,
  open,
  onChanged,
  onClose,
}: {
  albumId: string;
  memberIds: Set<string>;
  open: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

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

  const photos = photosQuery.data ?? [];
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PhotoPickerGrid
        isLoading={photosQuery.isPending}
        memberIds={memberIds}
        photos={photos}
        selected={selected}
        onToggle={toggle}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-sm text-neutral-400">
          已选 {selectedAddable.length} 张
          {memberIds.size > 0 && ` · 专辑内已有 ${memberIds.size} 张`}
        </span>
        <Button onClick={onClose} type="button" variant="ghost">
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
      </div>
    </div>
  );
}

/** 本机上传 tab 的行状态：上传中 / 纳入中 / 成功 / 失败（行内重试）。 */
interface UploadRow {
  key: string;
  file: File;
  /** 已上传成功（响应丢失重试时只补纳入，不再重传文件）。 */
  photoId?: string;
  stage: "uploading" | "attaching" | "done" | "failed";
  error?: string;
}

let uploadRowSeq = 0;

/** 本机上传 tab：多选文件逐张上传 + 逐张纳入专辑；失败行内单张重试。 */
function UploadTab({
  albumId,
  onChanged,
  onClose,
}: {
  albumId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = rows.some(
    (row) => row.stage === "uploading" || row.stage === "attaching",
  );

  function updateRow(key: string, patch: Partial<UploadRow>) {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  /** 单行管线：上传（已有 photoId 则跳过）→ 纳入专辑。失败停在 failed。 */
  async function processRow(row: UploadRow) {
    setError(null);
    try {
      let photoId = row.photoId;
      if (!photoId) {
        updateRow(row.key, { stage: "uploading", error: undefined });
        const form = new FormData();
        form.append("file", row.file);
        const photo = await apiFetch<Photo>("/admin/photos/upload", {
          method: "POST",
          body: form,
        });
        photoId = photo.id;
        updateRow(row.key, { photoId });
      }
      updateRow(row.key, { stage: "attaching" });
      await apiFetch(`/admin/albums/${albumId}/photos`, {
        method: "POST",
        body: JSON.stringify({ photoIds: [photoId] }),
      });
      updateRow(row.key, { stage: "done", error: undefined });
      queryClient.invalidateQueries({ queryKey: ["photos"] });
      onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : "上传失败";
      updateRow(row.key, { stage: "failed", error: message });
      toast.error(`「${row.file.name}」${message}`);
    }
  }

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (list.length === 0) return;
    const newRows: UploadRow[] = list.map((file) => {
      uploadRowSeq += 1;
      return {
        key: `upload-${uploadRowSeq}`,
        file,
        stage: "uploading",
      };
    });
    setRows((prev) => [...prev, ...newRows]);
    // 逐张顺序处理（不做整体重传与断点续传）
    for (const row of newRows) {
      await processRow(row);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          一次可多选；每张上传成功后立即纳入本专辑，失败可单张重试。
        </p>
        <Button
          className="border-dashed"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          type="button"
          variant="outline"
        >
          {busy ? "处理中…" : "选择文件"}
        </Button>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          multiple
          onChange={(event) => void handleFiles(event.target.files)}
          ref={fileInputRef}
          type="file"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-800">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">
            还没有选择文件——点「选择文件」从本机挑照片。
          </p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {rows.map((row) => (
              <li className="flex items-center gap-3 px-3 py-2" key={row.key}>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {row.file.name}
                </span>
                {row.stage === "uploading" && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
                    <Loader2 className="animate-spin" size={13} />
                    上传中…
                  </span>
                )}
                {row.stage === "attaching" && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
                    <Loader2 className="animate-spin" size={13} />
                    纳入中…
                  </span>
                )}
                {row.stage === "done" && (
                  <span className="shrink-0 text-xs text-neutral-400">
                    成功
                  </span>
                )}
                {row.stage === "failed" && (
                  <>
                    <span
                      className="min-w-0 max-w-48 shrink truncate text-xs text-red-400"
                      title={row.error}
                    >
                      {row.error}
                    </span>
                    <Button
                      aria-label={`重试 ${row.file.name}`}
                      disabled={busy}
                      onClick={() => {
                        void processRow(row);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCcw size={13} />
                      重试
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-end">
        <Button onClick={onClose} type="button" variant="ghost">
          <X size={14} />
          关闭
        </Button>
      </div>
    </div>
  );
}

/** 网盘选 tab：共享网盘树（浏览 + 勾选图片）→ 导入管线附带 albumId。 */
function NetdiskTab({
  albumId,
  status,
  statusPending,
  onClose,
}: {
  albumId: string;
  status: BaiduConnectionStatus | undefined;
  statusPending: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<
    Map<string, BaiduFileEntry>
  >(new Map());
  const [error, setError] = useState<string | null>(null);

  // 未连接时不拉根目录与 fsid 集合（避免状态未定/未授权时的无谓请求）
  const connected = status?.connected === true;
  const tree = useNetdiskTreeNodes(connected);
  const fsidsQuery = useQuery({
    queryKey: ["netdisk-synced-fsids"],
    queryFn: () => apiFetch<{ fsids: string[] }>("/admin/netdisk/synced-fsids"),
    enabled: connected,
  });
  const syncedFsIds = new Set(fsidsQuery.data?.fsids ?? []);

  const importMutation = useMutation({
    mutationFn: (entries: CreateBaiduImportInput["entries"]) =>
      apiFetch<unknown>("/admin/imports/baidu", {
        method: "POST",
        body: JSON.stringify({ entries, albumId }),
      }),
    onSuccess: (_data, entries) => {
      toast.success(`导入中 ${entries.length} 张，完成后自动纳入本专辑`);
      void queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  function toggleSelection(entry: BaiduFileEntry, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
    setSelectedEntries((prev) => {
      const next = new Map(prev);
      if (checked) next.set(entry.path, entry);
      else next.delete(entry.path);
      return next;
    });
  }

  if (statusPending) {
    return <p className="p-4 text-sm text-neutral-400">加载中…</p>;
  }
  if (!status) {
    return <p className="p-4 text-sm text-red-400">连接状态加载失败</p>;
  }

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
        <Button asChild>
          <a href="/api/admin/baidu/authorize">
            <Link2 size={15} />
            连接百度网盘
          </a>
        </Button>
      </div>
    );
  }

  const entries = [...selectedEntries.values()].map((entry) => ({
    fsId: entry.fsId,
    path: entry.path,
    serverFilename: entry.serverFilename,
    isDir: entry.isDir,
    size: entry.size,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-neutral-500">
        浏览网盘并勾选图片（仅图片文件可勾选），提交后走导入管线拉进照片库，
        导入完成后自动纳入本专辑（异步，无需等待）。
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <NetdiskTree
          controller={tree}
          mode="pick"
          selected={selected}
          syncedFsIds={syncedFsIds}
          onToggleSelection={toggleSelection}
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {selected.size > 0 && (
          <Button
            onClick={() => {
              setSelected(new Set());
              setSelectedEntries(new Map());
            }}
            type="button"
            variant="ghost"
          >
            清除选择
          </Button>
        )}
        <Button
          disabled={entries.length === 0 || importMutation.isPending}
          onClick={() => importMutation.mutate(entries)}
          type="button"
        >
          <CloudDownload size={15} />
          {importMutation.isPending
            ? "创建中…"
            : `导入并纳入（${entries.length} 张）`}
        </Button>
      </div>
    </div>
  );
}
