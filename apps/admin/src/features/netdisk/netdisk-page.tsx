import type {
  BaiduDirectoryListing,
  BaiduFileEntry,
  CreateBaiduImportInput,
} from "@photo/shared";
import { sanitizeNetdiskName } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ZoomIn,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { PhotoLightbox } from "../../components/photo-lightbox.jsx";
import { apiFetch } from "../../lib/api.js";
import { AdminShell } from "../../lib/shell.js";
import { baiduStatusQuery } from "../albums/baidu-import-dialog.jsx";

/** 只导入图片：与后端 isImportableImage 同判据（category===3 为主，扩展名兜底）。 */
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

function isImportableImage(entry: BaiduFileEntry): boolean {
  if (entry.category === 3) return true;
  const ext = entry.serverFilename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
  const syncedFsIds = useMemo(
    () => new Set(fsidsQuery.data?.fsids ?? []),
    [fsidsQuery.data],
  );

  // 挂载且已连接后拉取根目录（根没有可点的行，必须主动加载）
  useEffect(() => {
    if (statusQuery.data?.connected) void fetchIntoTree("", 1, false);
  }, [statusQuery.data?.connected]);

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

  function toggleDir(dir: string) {
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
    const isImage = !entry.isDir && isImportableImage(entry);
    const canSelect = isImage && !syncedFsIds.has(String(entry.fsId));
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

          {canSelect && (
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
          )}

          <span className="min-w-0 flex-1 truncate text-sm">
            {entry.serverFilename}
          </span>

          {entry.isDir ? (
            albumTitle ? (
              <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                专辑：{albumTitle}
              </span>
            ) : (
              <span className="shrink-0 rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-500">
                未对应
              </span>
            )
          ) : isImage ? (
            synced ? (
              <span className="shrink-0 rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-300">
                已导入
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-amber-900/60 px-2 py-0.5 text-xs text-amber-300">
                未导入
              </span>
            )
          ) : null}

          {!entry.isDir && (
            <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
              {formatSize(entry.size)}
            </span>
          )}

          {entry.isDir && (
            <button
              className="shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-400"
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
              type="button"
            >
              导入此文件夹
            </button>
          )}
          {isImage && lightboxIndex >= 0 && (
            <button
              aria-label={`预览 ${entry.serverFilename}`}
              className="shrink-0 text-neutral-500 hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                setViewing(lightboxIndex);
              }}
              type="button"
            >
              <ZoomIn size={14} />
            </button>
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
              <button
                className="py-2 text-xs text-neutral-400 hover:text-white"
                onClick={() => loadMore(entry.path)}
                style={{ paddingLeft: (depth + 1) * 18 + 44 }}
                type="button"
              >
                加载更多…
              </button>
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
          <Link
            className="inline-block rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
            to="/settings"
          >
            去连接
          </Link>
        </main>
      </AdminShell>
    );
  }

  const root = nodes[""];

  return (
    <AdminShell>
      <main className="mx-auto min-h-screen max-w-6xl space-y-4 p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-medium">网盘</h1>
            <p className="text-sm text-neutral-500">
              只读浏览网盘镜像；「导入」= 拉进站内（网盘侧不受影响）
            </p>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400"
            onClick={refreshAll}
            type="button"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3">
            <span className="text-sm">已选 {selected.size} 张未导入照片</span>
            <button
              className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black"
              onClick={() => {
                const entries: CreateBaiduImportInput["entries"] = [];
                for (const path of selected) {
                  for (const node of Object.values(nodes)) {
                    const hit = node?.entries.find(
                      (entry) => entry.path === path,
                    );
                    if (hit) {
                      entries.push({
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
                setImportTarget(entries);
              }}
              type="button"
            >
              导入选中…
            </button>
            <button
              className="text-sm text-neutral-400 hover:text-white"
              onClick={() => setSelected(new Set())}
              type="button"
            >
              取消选择
            </button>
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
      </main>

      {importTarget && (
        <AlbumPickerDialog
          count={importTarget.length}
          onClose={() => setImportTarget(null)}
          onSubmit={(albumId, albumTitle) => {
            createImport.mutate({ albumId, albumTitle, entries: importTarget });
          }}
        />
      )}
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

/** 导入发起：选专辑 → POST /admin/imports/baidu → toast 收尾。 */
function AlbumPickerDialog(props: {
  count: number;
  onClose: () => void;
  onSubmit: (albumId: string, albumTitle: string) => void;
}) {
  const { count, onClose, onSubmit } = props;
  const [albumId, setAlbumId] = useState("");
  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () =>
      apiFetch<{ id: string; title: string; photoCount: number }[]>(
        "/admin/albums",
      ),
  });
  const albums = albumsQuery.data ?? [];
  const chosen = albums.find((album) => album.id === albumId);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 弹窗遮罩点击关闭，关闭有按钮
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
        <h2 className="text-lg font-medium">导入到专辑</h2>
        <p className="text-sm text-neutral-400">
          将所选内容（{count}
          项，文件夹由服务端展开）导入到目标专辑；导入成功后自动标记为已同步。
        </p>
        <select
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          onChange={(event) => setAlbumId(event.target.value)}
          value={albumId}
        >
          <option disabled value="">
            选择目标专辑…
          </option>
          {albums.map((album) => (
            <option key={album.id} value={album.id}>
              {album.title}（{album.photoCount} 张）
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            disabled={!albumId}
            onClick={() => chosen && onSubmit(chosen.id, chosen.title)}
            type="button"
          >
            创建导入任务
          </button>
        </div>
      </div>
    </div>
  );
}
