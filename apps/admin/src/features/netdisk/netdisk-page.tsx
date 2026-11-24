import type {
  BaiduFileEntry,
  CreateBaiduImportInput,
  NetdiskUploadTask,
} from "@photo/shared";
import {
  netdiskCreateFolderInputSchema,
  sanitizeNetdiskName,
} from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  FolderPlus,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api";
import { AdminShell } from "@/lib/shell";
import { baiduStatusQuery } from "./baidu-status";
import { FolderPickerTree } from "./folder-picker-tree";
import {
  formatSize,
  isImportableImage,
  NetdiskTree,
  parentOf,
  useNetdiskTreeNodes,
} from "./netdisk-tree";

/** 单文件上限 2GB，与后端 multer limits 一致（前端预检，省一次白传）。 */
const MAX_UPLOAD_SIZE = 2 * 1024 ** 3;

/** 本地唯一 ID，仅用作前端 state key，不发送到服务端。
 * crypto.randomUUID 仅安全上下文（HTTPS/localhost）可用；admin 支持局域网 IP 访问
 * （vite server.host: true），非安全上下文下该 API 不存在，
 * 故用 crypto.getRandomValues（不受限）拼 v4 UUID 兜底。 */
function makeLocalId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 浏览器 → 服务端的在途上传（服务端任务入队前先显示这里）。 */
interface ClientUpload {
  id: string;
  filename: string;
  size: number;
  pct: number;
}

export function NetdiskPage() {
  // NetdiskBrowser 各分支已自带 AdminShell，这里不再包一层（否则双 header）
  return <NetdiskBrowser />;
}

function NetdiskBrowser() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(baiduStatusQuery);
  const connected = statusQuery.data?.connected === true;

  // 目录树状态（主树与新建文件夹弹框的父目录选择器共享同一份 nodes）
  const tree = useNetdiskTreeNodes(connected);

  // 勾选状态（key = 网盘路径）：集合用于行渲染，map 存条目供导入/删除取值
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<
    Map<string, BaiduFileEntry>
  >(new Map());
  const [importTarget, setImportTarget] = useState<
    CreateBaiduImportInput["entries"] | null
  >(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // 新建文件夹的父目录（弹框内选择器可改选；"" = 应用根）
  const [newFolderDir, setNewFolderDir] = useState("");
  // 名称字段是否已被交互（控制内联校验文案何时出现）
  const [nameTouched, setNameTouched] = useState(false);
  // 待删除条目（单删/批删共用一个确认弹窗）
  const [deleteTarget, setDeleteTarget] = useState<{
    paths: string[];
    label: string;
  } | null>(null);
  const [clientUploads, setClientUploads] = useState<ClientUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 站内对照：已导入（被照片索引）的 fsid 集合
  const fsidsQuery = useQuery({
    queryKey: ["netdisk-synced-fsids"],
    queryFn: () => apiFetch<{ fsids: string[] }>("/admin/netdisk/synced-fsids"),
    enabled: connected,
  });
  // 后台上传任务（有进行中/等待任务时 2s 轮询，否则 15s 兜底）
  const uploadsQuery = useQuery({
    queryKey: ["netdisk-uploads"],
    queryFn: () =>
      apiFetch<{ tasks: NetdiskUploadTask[] }>("/admin/netdisk/uploads"),
    enabled: connected,
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? [];
      const busy =
        tasks.some(
          (task) => task.state === "active" || task.state === "waiting",
        ) || clientUploads.length > 0;
      return busy ? 2_000 : 15_000;
    },
  });
  const syncedFsIds = useMemo(
    () => new Set(fsidsQuery.data?.fsids ?? []),
    [fsidsQuery.data],
  );

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

  function clearSelection() {
    setSelected(new Set());
    setSelectedEntries(new Map());
  }

  function refreshAll() {
    tree.refreshAll();
    clearSelection();
  }

  // ---- 新建文件夹 / 删除 / 直接上传 ----

  /** 打开新建文件夹弹框（预选父目录 dir，弹框内可改选）。 */
  function openNewFolder(dir: string) {
    setNewFolderDir(dir);
    setNewFolderName("");
    setNameTouched(false);
    setNewFolderOpen(true);
  }

  const createFolder = useMutation({
    mutationFn: (vars: { dir: string; name: string }) =>
      apiFetch<{ path: string }>("/admin/netdisk/folders", {
        method: "POST",
        body: JSON.stringify({ dir: vars.dir, name: vars.name }),
      }),
    onSuccess: (_data, vars) => {
      setNewFolderOpen(false);
      setNewFolderName("");
      tree.refreshDir(vars.dir);
      toast.success(`已创建文件夹「${vars.name}」`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建文件夹失败"),
  });

  const deleteEntries = useMutation({
    mutationFn: (paths: string[]) =>
      apiFetch<{ deleted: number; clearedPhotos: number }>(
        "/admin/netdisk/entries/delete",
        { method: "POST", body: JSON.stringify({ paths }) },
      ),
    onSuccess: (data, paths) => {
      setDeleteTarget(null);
      clearSelection();
      // 被删目录的树缓存一并清掉（同名重建后展开不会看到旧内容）
      tree.forgetDirs(paths);
      for (const parent of new Set(paths.map(parentOf))) {
        tree.refreshDir(parent);
      }
      void queryClient.invalidateQueries({
        queryKey: ["netdisk-synced-fsids"],
      });
      toast.success(
        data.clearedPhotos > 0
          ? `已删除 ${data.deleted} 项（${data.clearedPhotos} 张照片的镜像映射已清除，进回收站）`
          : `已删除 ${data.deleted} 项（进回收站）`,
      );
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  /** 浏览器 → 服务端上传（XHR 以获取进度），成功后任务转后台队列。 */
  function uploadViaXhr(
    file: File,
    dir: string,
    onProgress: (pct: number) => void,
  ): Promise<{ taskId: string }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/netdisk/files/upload");
      xhr.withCredentials = true;
      xhr.responseType = "json";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        const body = xhr.response as {
          taskId?: string;
          message?: string;
        } | null;
        if (xhr.status >= 200 && xhr.status < 300 && body?.taskId) {
          resolvePromise({ taskId: body.taskId });
        } else {
          rejectPromise(
            new ApiError(
              xhr.status,
              xhr.status === 413
                ? `「${file.name}」超过 2GB 上限`
                : (body?.message ?? `上传失败（HTTP ${xhr.status}）`),
            ),
          );
        }
      };
      xhr.onerror = () => rejectPromise(new Error("上传失败（网络错误）"));
      const form = new FormData();
      form.append("file", file);
      form.append("dir", dir);
      xhr.send(form);
    });
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_UPLOAD_SIZE) {
        toast.error(`「${file.name}」超过 2GB 上限，已跳过`);
        continue;
      }
      if (file.size === 0) {
        toast.error(`「${file.name}」是空文件，已跳过`);
        continue;
      }
      const id = makeLocalId();
      setClientUploads((prev) => [
        ...prev,
        { id, filename: file.name, size: file.size, pct: 0 },
      ]);
      try {
        await uploadViaXhr(file, tree.currentDir, (pct) =>
          setClientUploads((prev) =>
            prev.map((upload) =>
              upload.id === id ? { ...upload, pct } : upload,
            ),
          ),
        );
        toast.success(`「${file.name}」已进入后台上传队列`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : `「${file.name}」上传失败`,
        );
      } finally {
        setClientUploads((prev) => prev.filter((upload) => upload.id !== id));
        void queryClient.invalidateQueries({
          queryKey: ["netdisk-uploads"],
        });
      }
    }
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    void uploadFiles(event.target.files);
    // 允许再次选择同一文件
    event.target.value = "";
  }

  // 服务端任务状态翻转 → 提示 + 刷新对应目录（完成后树里可见）
  const prevTaskStatesRef = useRef<Map<string, string>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应任务数据变化；tree 的方法是闭包函数
  useEffect(() => {
    const tasks = uploadsQuery.data?.tasks ?? [];
    const prev = prevTaskStatesRef.current;
    const next = new Map<string, string>();
    for (const task of tasks) {
      next.set(task.id, task.state);
      const before = prev.get(task.id);
      if (!before || before === task.state) continue;
      if (task.state === "completed") {
        toast.success(`「${task.filename}」已上传到网盘`);
        tree.refreshDir(parentOf(task.destPath));
      } else if (task.state === "failed") {
        toast.error(
          `「${task.filename}」上传失败：${task.error ?? "未知错误"}`,
        );
      }
    }
    prevTaskStatesRef.current = next;
  }, [uploadsQuery.data]);

  const createImport = useMutation({
    mutationFn: async (vars: {
      entries: CreateBaiduImportInput["entries"];
    }) => {
      await apiFetch("/admin/imports/baidu", {
        method: "POST",
        body: JSON.stringify({ entries: vars.entries }),
      });
      return vars;
    },
    onSuccess: (vars) => {
      clearSelection();
      setImportTarget(null);
      void queryClient.invalidateQueries({
        queryKey: ["netdisk-synced-fsids"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["import-jobs"],
      });
      toast.success(
        `已创建导入任务（${vars.entries.length} 项）——照片将进入照片库，之后在专辑编辑页「添加照片」挑图`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建导入任务失败"),
  });

  if (statusQuery.isPending) {
    return (
      <AdminShell>
        <main className="p-8 text-sm text-neutral-400">加载中…</main>
      </AdminShell>
    );
  }
  if (statusQuery.data && !statusQuery.data.connected) {
    return (
      <AdminShell>
        <main className="mx-auto max-w-6xl space-y-3 p-8">
          <h1 className="text-2xl font-medium">网盘</h1>
          <p className="text-sm text-neutral-400">
            尚未连接百度网盘，请先到站点设置完成授权。
          </p>
          <Button asChild>
            <Link to="/settings">去连接</Link>
          </Button>
        </main>
      </AdminShell>
    );
  }

  // 批量导入按钮可用性：至少一个文件夹或可导入的未导入图片
  const selectionEntries: CreateBaiduImportInput["entries"] = [
    ...selectedEntries.values(),
  ];
  const canImportSelection = selectionEntries.some(
    (entry) =>
      entry.isDir ||
      (isImportableImage(entry.serverFilename, null) &&
        !syncedFsIds.has(String(entry.fsId))),
  );

  // 新建文件夹名称内联校验：空名/超长按 shared schema 文案拦截（输入框
  // maxLength=100 对齐 schema max，超长实际到不了）；非法字符不拦——shared
  // 规则是替换为下划线（sanitizeNetdiskName），在弹框内预览提示
  const parsedName =
    netdiskCreateFolderInputSchema.shape.name.safeParse(newFolderName);
  const nameError = !parsedName.success
    ? (parsedName.error.issues[0]?.message ?? "文件夹名称无效")
    : newFolderName.trim() === ""
      ? "文件夹名称不能为空"
      : null;
  const sanitizedName = sanitizeNetdiskName(newFolderName);
  const showSanitizedPreview =
    parsedName.success && sanitizedName !== newFolderName;

  return (
    <AdminShell>
      <main className="mx-auto min-h-screen max-w-6xl space-y-4 p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-medium">网盘</h1>
            <p className="text-sm text-neutral-500">
              浏览与管理网盘内容：删除进回收站；「导入」=
              拉进站内（网盘侧不受影响）
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={refreshAll} type="button" variant="outline">
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button
              onClick={() => openNewFolder(tree.currentDir)}
              type="button"
              variant="outline"
            >
              <FolderPlus size={14} />
              新建文件夹
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} type="button">
              <Upload size={14} />
              上传文件
            </Button>
            <input
              className="hidden"
              multiple
              onChange={onFileInputChange}
              ref={fileInputRef}
              type="file"
            />
          </div>
        </div>

        <p className="text-xs text-neutral-600">
          上传落点：
          <span className="text-neutral-400">
            {tree.currentDir === ""
              ? "应用目录（点击目录行切换）"
              : tree.currentDir}
          </span>
        </p>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3">
            <span className="text-sm">已选 {selected.size} 项</span>
            <Button
              disabled={!canImportSelection}
              onClick={() => setImportTarget(selectionEntries)}
              size="sm"
              type="button"
            >
              导入选中…
            </Button>
            <Button
              onClick={() =>
                setDeleteTarget({
                  paths: [...selected],
                  label: `选中的 ${selected.size} 项`,
                })
              }
              size="sm"
              type="button"
              variant="outline"
              className="border-red-900 text-red-400 hover:border-red-500"
            >
              删除选中…
            </Button>
            <Button onClick={clearSelection} type="button" variant="ghost">
              取消选择
            </Button>
          </div>
        )}

        <NetdiskTree
          controller={tree}
          mode="manage"
          selected={selected}
          syncedFsIds={syncedFsIds}
          onDelete={(entry) =>
            setDeleteTarget({
              paths: [entry.path],
              label: entry.serverFilename,
            })
          }
          onImportFolder={(entry) =>
            setImportTarget([
              {
                fsId: entry.fsId,
                path: entry.path,
                serverFilename: entry.serverFilename,
                isDir: true,
                size: 0,
              },
            ])
          }
          onNewFolder={openNewFolder}
          onToggleSelection={toggleSelection}
        />

        <UploadTasksPanel
          clientUploads={clientUploads}
          tasks={uploadsQuery.data?.tasks ?? []}
        />
      </main>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setNewFolderName("");
            setNameTouched(false);
          }
          setNewFolderOpen(open);
        }}
        open={newFolderOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>
              在{" "}
              <span className="text-neutral-300">
                {newFolderDir === "" ? "应用目录" : newFolderDir}
              </span>{" "}
              下创建；可在下方目录树中改选父目录。
            </DialogDescription>
          </DialogHeader>
          <FolderPickerTree
            nodes={tree.nodes}
            onChange={setNewFolderDir}
            onFetchDir={tree.fetchIntoTree}
            rootDir={tree.rootDirRef.current}
            value={newFolderDir}
          />
          <div className="space-y-1.5">
            <Input
              autoFocus
              maxLength={100}
              onChange={(event) => {
                setNameTouched(true);
                setNewFolderName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !createFolder.isPending) {
                  setNameTouched(true);
                  if (nameError === null) {
                    createFolder.mutate({
                      dir: newFolderDir,
                      name: newFolderName,
                    });
                  }
                }
              }}
              placeholder="文件夹名称"
              value={newFolderName}
            />
            {nameTouched && nameError ? (
              <p className="text-xs text-red-400">{nameError}</p>
            ) : showSanitizedPreview ? (
              <p className="text-xs text-neutral-500">
                非法字符将替换为下划线，保存为「{sanitizedName}」
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setNewFolderOpen(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={nameError !== null || createFolder.isPending}
              onClick={() =>
                createFolder.mutate({ dir: newFolderDir, name: newFolderName })
              }
              type="button"
            >
              {createFolder.isPending ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        danger
        description={`「${deleteTarget?.label ?? ""}」将从网盘删除（进回收站）。若其中包含已导入照片的源文件，对应照片会变回「未同步」，可用全量推送恢复（暂存原件仍在本地时）。`}
        onConfirm={() => deleteEntries.mutateAsync(deleteTarget?.paths ?? [])}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        pending={deleteEntries.isPending}
        title="删除网盘内容"
      />

      <ConfirmDialog
        confirmText="开始导入"
        description={`将所选 ${importTarget?.length ?? 0} 项（文件夹由服务端展开，仅图片）登记为照片——只入照片库，不进任何专辑；之后在专辑编辑页「添加照片」挑图。`}
        onConfirm={() => {
          if (importTarget) createImport.mutate({ entries: importTarget });
        }}
        onOpenChange={(open) => {
          if (!open) setImportTarget(null);
        }}
        open={importTarget !== null}
        pending={createImport.isPending}
        title="导入到照片库"
      />
    </AdminShell>
  );
}

/** 后台上传任务面板：在途（浏览器→服务端）+ 服务端队列任务。 */
function UploadTasksPanel(props: {
  clientUploads: ClientUpload[];
  tasks: NetdiskUploadTask[];
}) {
  const { clientUploads, tasks } = props;
  if (clientUploads.length === 0 && tasks.length === 0) {
    return null;
  }

  const stateView = (state: NetdiskUploadTask["state"]) => {
    switch (state) {
      case "completed":
        return (
          <Badge className="shrink-0" variant="success">
            <CheckCircle2 size={12} />
            已完成
          </Badge>
        );
      case "failed":
        return (
          <Badge className="shrink-0" variant="warning">
            <XCircle size={12} />
            失败
          </Badge>
        );
      case "active":
        return (
          <Badge className="shrink-0">
            <Loader2 className="animate-spin" size={12} />
            后台上传中
          </Badge>
        );
      default:
        return (
          <Badge className="shrink-0" variant="outline">
            <Clock size={12} />
            等待中
          </Badge>
        );
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm text-neutral-400">
        <Upload size={13} />
        后台上传任务
      </p>
      <div className="space-y-1.5">
        {clientUploads.map((upload) => (
          <div
            className="flex items-center gap-2 text-xs text-neutral-400"
            key={upload.id}
          >
            <Loader2 className="shrink-0 animate-spin" size={13} />
            <span className="min-w-0 flex-1 truncate">
              {upload.filename}（正在上传到服务器）
            </span>
            <span className="shrink-0 tabular-nums">{upload.pct}%</span>
          </div>
        ))}
        {tasks.map((task) => (
          <div
            className="flex items-center gap-2 text-xs text-neutral-400"
            key={task.id}
          >
            {stateView(task.state)}
            <span className="min-w-0 flex-1 truncate">
              {task.filename} → {task.destPath}
            </span>
            <span className="hidden shrink-0 text-neutral-600 sm:inline">
              {formatSize(task.size)}
            </span>
            {task.state === "active" && (
              <span className="shrink-0 tabular-nums">{task.progress}%</span>
            )}
            {task.state === "failed" && task.error && (
              <span
                className="hidden min-w-0 max-w-48 shrink truncate text-red-400 sm:inline"
                title={task.error}
              >
                {task.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
