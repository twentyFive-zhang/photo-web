import type {
  BaiduDirectoryListing,
  BaiduFileEntry,
  CreateBaiduImportInput,
  NetdiskUploadTask,
} from "@photo/shared";
import { sanitizeNetdiskName } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
  ZoomIn,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoLightbox } from "@/components/photo-lightbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiFetch } from "@/lib/api";
import { AdminShell } from "@/lib/shell";
import { baiduStatusQuery } from "../albums/baidu-import-dialog";

/** 只导入图片：与后端 isImportableImage 同判据（category===3 为主，扩展名兜底）。 */
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

/** 单文件上限 2GB，与后端 multer limits 一致（前端预检，省一次白传）。 */
const MAX_UPLOAD_SIZE = 2 * 1024 ** 3;

/** category 未知时传 null（只按扩展名判断，与后端导入服务同口径）。 */
function isImportableImage(filename: string, category: number | null): boolean {
  if (category === 3) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** 分页追加时按 fsId 去重（百度 list 偶发跨页重复）。 */
function dedupeById(entries: BaiduFileEntry[]): BaiduFileEntry[] {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (seen.has(entry.fsId)) return false;
    seen.add(entry.fsId);
    return true;
  });
}

/** 树节点状态：某目录已加载的条目与分页。根目录的 key 是空串（服务端归一化到应用目录）。 */
interface NodeState {
  entries: BaiduFileEntry[];
  page: number;
  hasMore: boolean;
  expanded: boolean;
  loading: boolean;
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

  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importTarget, setImportTarget] = useState<
    CreateBaiduImportInput["entries"] | null
  >(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  // 当前浏览目录（树 key，"" = 应用目录）：新建/上传的落点
  const [currentDir, setCurrentDir] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // 待删除条目（单删/批删共用一个确认弹窗）
  const [deleteTarget, setDeleteTarget] = useState<{
    paths: string[];
    label: string;
  } | null>(null);
  const [clientUploads, setClientUploads] = useState<ClientUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 树根对应的服务端目录（上传完成/删除后按服务端路径刷新树节点用）
  const rootDirRef = useRef<string>("");

  // 站内对照：已导入 fsid 集合 + 目录名 → 专辑标题
  const fsidsQuery = useQuery({
    queryKey: ["netdisk-synced-fsids"],
    queryFn: () => apiFetch<{ fsids: string[] }>("/admin/netdisk/synced-fsids"),
    enabled: statusQuery.data?.connected === true,
  });
  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => apiFetch<{ id: string; title: string }[]>("/admin/albums"),
    enabled: statusQuery.data?.connected === true,
  });
  // 后台上传任务（有进行中/等待任务时 2s 轮询，否则 15s 兜底）
  const uploadsQuery = useQuery({
    queryKey: ["netdisk-uploads"],
    queryFn: () =>
      apiFetch<{ tasks: NetdiskUploadTask[] }>("/admin/netdisk/uploads"),
    enabled: statusQuery.data?.connected === true,
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

  // 挂载且已连接后拉取根目录（根没有可点的行，必须主动加载）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在连接状态翻转时拉一次；fetchIntoTree 是闭包函数，入依赖会每次渲染重新触发
  useEffect(() => {
    if (statusQuery.data?.connected) void fetchIntoTree("", 1, false);
  }, [statusQuery.data?.connected]);

  /** 拉取目录一页合并进树（文件夹在前，其余按修改时间倒序）。 */
  async function fetchIntoTree(dir: string, page: number, append: boolean) {
    setNodes((prev) => ({
      ...prev,
      [dir]: {
        entries: prev[dir]?.entries ?? [],
        page: prev[dir]?.page ?? 0,
        hasMore: prev[dir]?.hasMore ?? true,
        expanded: true,
        loading: true,
      },
    }));
    try {
      const listing = await apiFetch<BaiduDirectoryListing>(
        `/admin/baidu/files?dir=${encodeURIComponent(dir)}&page=${page}`,
      );
      if (dir === "") rootDirRef.current = listing.dir;
      const sorted = [...listing.entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return b.mtime - a.mtime;
      });
      setNodes((prev) => {
        const current = prev[dir];
        const merged = append
          ? dedupeById([...(current?.entries ?? []), ...sorted])
          : sorted;
        return {
          ...prev,
          // 按请求的 dir 作键（空串 = 根）：listing.dir 是服务端归一化后的
          // 应用根路径，与渲染读的键对不上会导致树永远不出现
          [dir]: {
            entries: merged,
            page: listing.page,
            hasMore: listing.hasMore,
            expanded: true,
            loading: false,
          },
        };
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载目录失败");
      setNodes((prev) => ({
        ...prev,
        [dir]: { ...prev[dir], loading: false },
      }));
    }
  }

  /** 按服务端绝对路径刷新树节点（根路径映射回空串 key）。 */
  function refreshDirNode(dirPath: string) {
    if (!dirPath) return;
    const key = dirPath === rootDirRef.current ? "" : dirPath;
    void fetchIntoTree(key, 1, false);
  }

  function toggleDir(dir: string) {
    setCurrentDir(dir);
    const node = nodes[dir];
    if (node && node.page > 0) {
      // 已有数据：仅折叠/展开
      setNodes((prev) => ({
        ...prev,
        [dir]: { ...prev[dir], expanded: !prev[dir].expanded },
      }));
      return;
    }
    void fetchIntoTree(dir, 1, false);
  }

  function loadMore(dir: string) {
    const node = nodes[dir];
    if (node) void fetchIntoTree(dir, node.page + 1, true);
  }

  function refreshAll() {
    setNodes({});
    setSelected(new Set());
    void fetchIntoTree("", 1, false);
  }

  // ---- 新建文件夹 / 删除 / 直接上传 ----

  const createFolder = useMutation({
    mutationFn: (vars: { dir: string; name: string }) =>
      apiFetch<{ path: string }>("/admin/netdisk/folders", {
        method: "POST",
        body: JSON.stringify({ dir: vars.dir, name: vars.name }),
      }),
    onSuccess: (_data, vars) => {
      setNewFolderOpen(false);
      setNewFolderName("");
      refreshDirNode(vars.dir || rootDirRef.current);
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
      setSelected(new Set());
      // 被删目录的树缓存一并清掉（同名重建后展开不会看到旧内容）
      setNodes((prev) => {
        const next = { ...prev };
        for (const path of paths) delete next[path];
        return next;
      });
      for (const parent of new Set(paths.map(parentOf))) {
        refreshDirNode(parent);
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
      const id = crypto.randomUUID();
      setClientUploads((prev) => [
        ...prev,
        { id, filename: file.name, size: file.size, pct: 0 },
      ]);
      try {
        await uploadViaXhr(file, currentDir, (pct) =>
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应任务数据变化；refreshDirNode 是闭包函数
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
        refreshDirNode(parentOf(task.destPath));
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
      albumId: string;
      albumTitle: string;
      entries: CreateBaiduImportInput["entries"];
    }) => {
      await apiFetch("/admin/imports/baidu", {
        method: "POST",
        body: JSON.stringify({ albumId: vars.albumId, entries: vars.entries }),
      });
      return vars;
    },
    onSuccess: (vars) => {
      setSelected(new Set());
      setImportTarget(null);
      void queryClient.invalidateQueries({
        queryKey: ["netdisk-synced-fsids"],
      });
      toast.success(
        `已创建导入任务（${vars.entries.length} 项）到「${vars.albumTitle}」，进度见专辑页`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建导入任务失败"),
  });
  const albumByDirName = useMemo(() => {
    const map = new Map<string, string>();
    for (const album of albumsQuery.data ?? []) {
      map.set(sanitizeNetdiskName(album.title), album.title);
    }
    return map;
  }, [albumsQuery.data]);

  /** 展开节点里带缩略图的图片（灯箱翻页用）。 */
  const visibleImages = useMemo(() => {
    const images: BaiduFileEntry[] = [];
    for (const node of Object.values(nodes)) {
      if (!node?.expanded) continue;
      for (const entry of node.entries) {
        if (!entry.isDir && entry.thumbUrl) images.push(entry);
      }
    }
    return images;
  }, [nodes]);

  /** 树行渲染（闭包持有全部状态，避免层层传 props）。 */
  function renderRow(entry: BaiduFileEntry, depth: number): ReactNode {
    const node = nodes[entry.path];
    const isImage =
      !entry.isDir && isImportableImage(entry.serverFilename, entry.category);
    const synced = syncedFsIds.has(String(entry.fsId));
    const lightboxIndex = visibleImages.findIndex(
      (image) => image.path === entry.path,
    );
    const albumTitle = entry.isDir
      ? albumByDirName.get(sanitizeNetdiskName(entry.serverFilename))
      : undefined;

    return (
      <div key={entry.path}>
        <div
          className={`flex items-center gap-2 border-b border-neutral-800/60 px-3 py-2 last:border-b-0 hover:bg-neutral-900/50 ${entry.isDir ? "cursor-pointer" : ""}`}
          {...(entry.isDir
            ? {
                onClick: () => toggleDir(entry.path),
                onKeyDown: (event: ReactKeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    toggleDir(entry.path);
                  }
                },
                role: "button" as const,
                tabIndex: 0 as const,
              }
            : {})}
        >
          <span className="shrink-0" style={{ width: depth * 18 }} />
          {entry.isDir ? (
            <>
              {node?.loading ? (
                <Loader2
                  className="shrink-0 animate-spin text-neutral-500"
                  size={16}
                />
              ) : node?.expanded ? (
                <ChevronDown className="shrink-0 text-neutral-500" size={16} />
              ) : (
                <ChevronRight className="shrink-0 text-neutral-500" size={16} />
              )}
              {node?.expanded ? (
                <FolderOpen className="shrink-0 text-neutral-400" size={16} />
              ) : (
                <Folder className="shrink-0 text-neutral-400" size={16} />
              )}
            </>
          ) : isImage && entry.thumbUrl && !brokenThumbs.has(entry.path) ? (
            // biome-ignore lint/performance/noImgElement: 缩略图来自百度 CDN 且有时效，不走 next/image
            <img
              alt={entry.serverFilename}
              className="h-9 w-9 shrink-0 rounded object-cover"
              onError={() =>
                setBrokenThumbs((prev) => new Set(prev).add(entry.path))
              }
              src={entry.thumbUrl}
            />
          ) : (
            <ImageIcon className="shrink-0 text-neutral-600" size={16} />
          )}

          <input
            aria-label={`选择 ${entry.serverFilename}`}
            checked={selected.has(entry.path)}
            className="shrink-0"
            onChange={(event) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (event.target.checked) next.add(entry.path);
                else next.delete(entry.path);
                return next;
              })
            }
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />

          <span className="min-w-0 flex-1 truncate text-sm">
            {entry.serverFilename}
          </span>

          {entry.isDir ? (
            albumTitle ? (
              <Badge className="shrink-0">专辑：{albumTitle}</Badge>
            ) : (
              <Badge className="shrink-0" variant="outline">
                未对应
              </Badge>
            )
          ) : isImage ? (
            synced ? (
              <Badge className="shrink-0" variant="success">
                已导入
              </Badge>
            ) : (
              <Badge className="shrink-0" variant="warning">
                未导入
              </Badge>
            )
          ) : null}

          {!entry.isDir && (
            <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
              {formatSize(entry.size)}
            </span>
          )}

          <Button
            aria-label={`删除 ${entry.serverFilename}`}
            className="shrink-0 text-neutral-500 hover:text-red-400"
            onClick={(event) => {
              event.stopPropagation();
              setDeleteTarget({
                paths: [entry.path],
                label: entry.serverFilename,
              });
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 size={14} />
          </Button>

          {entry.isDir && (
            <Button
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                setImportTarget([
                  {
                    fsId: entry.fsId,
                    path: entry.path,
                    serverFilename: entry.serverFilename,
                    isDir: true,
                    size: 0,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              导入此文件夹
            </Button>
          )}
          {isImage && lightboxIndex >= 0 && (
            <Button
              aria-label={`预览 ${entry.serverFilename}`}
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                setViewing(lightboxIndex);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ZoomIn size={14} />
            </Button>
          )}
        </div>

        {entry.isDir && node?.expanded && (
          <div className="border-l border-neutral-800/60">
            {node.entries.map((child) => renderRow(child, depth + 1))}
            {node.entries.length === 0 && !node.loading && (
              <p
                className="py-2 text-xs text-neutral-600"
                style={{ paddingLeft: (depth + 1) * 18 + 44 }}
              >
                空目录
              </p>
            )}
            {node.hasMore && (
              <Button
                className="h-auto py-2 text-xs"
                onClick={() => loadMore(entry.path)}
                style={{ paddingLeft: (depth + 1) * 18 + 44 }}
                type="button"
                variant="ghost"
              >
                加载更多…
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

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

  const root = nodes[""];
  // 批量导入按钮可用性：至少一个文件夹或可导入的未导入图片
  const selectionEntries: CreateBaiduImportInput["entries"] = [];
  for (const path of selected) {
    for (const node of Object.values(nodes)) {
      const hit = node?.entries.find((entry) => entry.path === path);
      if (hit) {
        selectionEntries.push({
          fsId: hit.fsId,
          path: hit.path,
          serverFilename: hit.serverFilename,
          isDir: hit.isDir,
          size: hit.size,
        });
        break;
      }
    }
  }
  const canImportSelection = selectionEntries.some(
    (entry) =>
      entry.isDir ||
      (isImportableImage(entry.serverFilename, null) &&
        !syncedFsIds.has(String(entry.fsId))),
  );

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
              onClick={() => setNewFolderOpen(true)}
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
          新建/上传落点：
          <span className="text-neutral-400">
            {currentDir === "" ? "应用目录（点击目录行切换）" : currentDir}
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
              <Trash2 size={14} />
              删除选中…
            </Button>
            <Button
              onClick={() => setSelected(new Set())}
              type="button"
              variant="ghost"
            >
              取消选择
            </Button>
          </div>
        )}

        {!root && (
          <p className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="animate-spin" size={14} />
            加载目录…
          </p>
        )}
        {root && (
          <div className="rounded-xl border border-neutral-800">
            {root.entries.length === 0 && !root.loading && (
              <p className="p-4 text-sm text-neutral-500">目录为空</p>
            )}
            {root.entries.map((entry) => renderRow(entry, 0))}
          </div>
        )}

        <UploadTasksPanel
          clientUploads={clientUploads}
          tasks={uploadsQuery.data?.tasks ?? []}
        />
      </main>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setNewFolderName("");
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
                {currentDir === "" ? "应用目录" : currentDir}
              </span>{" "}
              下创建。
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={100}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                newFolderName.trim() &&
                !createFolder.isPending
              ) {
                createFolder.mutate({ dir: currentDir, name: newFolderName });
              }
            }}
            placeholder="文件夹名称"
            value={newFolderName}
          />
          <DialogFooter>
            <Button
              onClick={() => setNewFolderOpen(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={!newFolderName.trim() || createFolder.isPending}
              onClick={() =>
                createFolder.mutate({ dir: currentDir, name: newFolderName })
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
        description={`「${deleteTarget?.label ?? ""}」将从网盘删除（进回收站）。若其中包含已导入照片的镜像，对应照片会变回「未推送」，可用全量推送/按专辑补推恢复。`}
        onConfirm={() => deleteEntries.mutateAsync(deleteTarget?.paths ?? [])}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        pending={deleteEntries.isPending}
        title="删除网盘内容"
      />

      <AlbumPickerDialog
        count={importTarget?.length ?? 0}
        onOpenChange={(open) => {
          if (!open) setImportTarget(null);
        }}
        onSubmit={(albumId, albumTitle) => {
          if (!importTarget) return;
          createImport.mutate({ albumId, albumTitle, entries: importTarget });
        }}
        open={importTarget !== null}
      />
      {viewing !== null && visibleImages[viewing] && (
        <PhotoLightbox
          index={viewing}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
          photos={visibleImages.map((entry) => ({
            url: entry.thumbUrl,
            title: entry.serverFilename,
            caption: null,
          }))}
        />
      )}
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

/** 导入发起：选专辑 → POST /admin/imports/baidu → toast 收尾。 */
function AlbumPickerDialog(props: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (albumId: string, albumTitle: string) => void;
}) {
  const { count, open, onOpenChange, onSubmit } = props;
  const [albumId, setAlbumId] = useState("");
  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () =>
      apiFetch<{ id: string; title: string; photoCount: number }[]>(
        "/admin/albums",
      ),
    enabled: open,
  });
  const albums = albumsQuery.data ?? [];
  const chosen = albums.find((album) => album.id === albumId);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) setAlbumId("");
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>导入到专辑</DialogTitle>
          <DialogDescription>
            将所选内容（{count}
            项，文件夹由服务端展开）导入到目标专辑；导入成功后自动标记为已同步。
          </DialogDescription>
        </DialogHeader>
        <Select onValueChange={setAlbumId} value={albumId || undefined}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择目标专辑…" />
          </SelectTrigger>
          <SelectContent>
            {albums.map((album) => (
              <SelectItem key={album.id} value={album.id}>
                {album.title}（{album.photoCount} 张）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={!albumId}
            onClick={() => chosen && onSubmit(chosen.id, chosen.title)}
            type="button"
          >
            创建导入任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
