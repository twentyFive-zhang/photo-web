import type { BaiduDirectoryListing, BaiduFileEntry } from "@photo/shared";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Trash2,
  ZoomIn,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { NodeState } from "./folder-picker-tree";

/** 只导入图片：与后端 isImportableImage 同判据（category===3 为主，扩展名兜底）。 */
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

/** category 未知时传 null（只按扩展名判断，与后端导入服务同口径）。 */
export function isImportableImage(
  filename: string,
  category: number | null,
): boolean {
  if (category === 3) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

export function formatSize(size: number): string {
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

/**
 * 网盘目录树的状态与加载逻辑（ADR 0007 自网盘管理页抽出共享）：
 * 懒加载 + 分页追加 + 目录展开折叠。同一实例的 nodes 可同时供主树与
 * 新建文件夹弹框的 FolderPickerTree 使用（沿用原先共享 nodes 的设计）。
 *
 * @param enabled 是否已连接百度网盘（未连接时不拉根目录）。
 */
export function useNetdiskTreeNodes(enabled: boolean) {
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  // 当前浏览目录（树 key，"" = 应用目录）：manage 模式作上传落点
  const [currentDir, setCurrentDir] = useState("");
  // 树根对应的服务端目录（refreshDir 按服务端路径映射回空串 key 用）
  const rootDirRef = useRef<string>("");

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

  /** 按服务端绝对路径刷新树节点（根路径或空串都映射回根 key ""）。 */
  function refreshDir(dirPath: string) {
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
    void fetchIntoTree("", 1, false);
  }

  /** 从树缓存摘除目录节点（删除目录后调用，防同名重建后看到旧内容）。 */
  function forgetDirs(paths: string[]) {
    setNodes((prev) => {
      const next = { ...prev };
      for (const path of paths) delete next[path];
      return next;
    });
  }

  // 连接就绪后拉取根目录（根没有可点的行，必须主动加载）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在 enabled 翻转时拉一次；fetchIntoTree 是闭包函数，入依赖会每次渲染重新触发
  useEffect(() => {
    if (enabled) void fetchIntoTree("", 1, false);
  }, [enabled]);

  return {
    nodes,
    currentDir,
    /** 树根对应的服务端目录（FolderPickerTree 推导祖先链用）。 */
    rootDirRef,
    fetchIntoTree,
    toggleDir,
    loadMore,
    refreshDir,
    refreshAll,
    forgetDirs,
  };
}

export type NetdiskTreeController = ReturnType<typeof useNetdiskTreeNodes>;

/**
 * 共享树组件的操作模式：
 * - manage：网盘管理页原行为——所有行可勾选、行内新建/删除/文件夹导入/
 *   灯箱预览、已导入/待导入徽标。
 * - pick：专辑「添加照片」网盘选 tab——只取浏览 + 勾选：仅图片文件可勾选，
 *   文件夹行仅导航展开（无任何行操作）。
 */
export type NetdiskTreeMode = "manage" | "pick";

interface NetdiskTreeProps {
  mode: NetdiskTreeMode;
  /** 目录状态与加载逻辑（useNetdiskTreeNodes 的返回值）。 */
  controller: NetdiskTreeController;
  /** 站内已导入（被照片索引）的 fsid 集合，行内徽标展示。 */
  syncedFsIds: Set<string>;
  /** 勾选状态（受控，key 为网盘路径）：manage 全部行可勾，pick 仅图片行。 */
  selected: Set<string>;
  onToggleSelection: (entry: BaiduFileEntry, checked: boolean) => void;
  /** manage 行操作（pick 模式不渲染这些按钮）。 */
  onNewFolder?: (dir: string) => void;
  onDelete?: (entry: BaiduFileEntry) => void;
  onImportFolder?: (entry: BaiduFileEntry) => void;
}

/**
 * 百度网盘文件树（ADR 0007 从网盘管理页抽出共享）：
 * 行内勾选与操作按 mode 裁剪；灯箱预览属于树自身（manage 模式）。
 */
export function NetdiskTree({
  mode,
  controller,
  syncedFsIds,
  selected,
  onToggleSelection,
  onNewFolder,
  onDelete,
  onImportFolder,
}: NetdiskTreeProps) {
  const { nodes, toggleDir, loadMore } = controller;
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);

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

  /** 树行渲染。manage/pick 的差异：勾选范围与行内操作按钮。 */
  function renderRow(entry: BaiduFileEntry, depth: number): ReactNode {
    const node = nodes[entry.path];
    const isImage =
      !entry.isDir && isImportableImage(entry.serverFilename, entry.category);
    const synced = syncedFsIds.has(String(entry.fsId));
    const lightboxIndex = visibleImages.findIndex(
      (image) => image.path === entry.path,
    );
    const manage = mode === "manage";
    // pick：仅图片文件可勾选；manage：全部行可勾选（文件夹勾选用于整夹导入）
    const checkable = manage || isImage;

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

          {checkable && (
            <input
              aria-label={`选择 ${entry.serverFilename}`}
              checked={selected.has(entry.path)}
              className="shrink-0"
              onChange={(event) =>
                onToggleSelection(entry, event.target.checked)
              }
              onClick={(event) => event.stopPropagation()}
              type="checkbox"
            />
          )}

          <span className="min-w-0 flex-1 truncate text-sm">
            {entry.serverFilename}
          </span>

          {!entry.isDir && isImage ? (
            synced ? (
              <Badge className="shrink-0" variant="success">
                已导入
              </Badge>
            ) : (
              <Badge className="shrink-0" variant="warning">
                待导入
              </Badge>
            )
          ) : null}

          {!entry.isDir && (
            <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
              {formatSize(entry.size)}
            </span>
          )}

          {manage && entry.isDir && (
            <Button
              aria-label={`在 ${entry.serverFilename} 中新建文件夹`}
              className="shrink-0 text-neutral-500 hover:text-red-400"
              onClick={(event) => {
                event.stopPropagation();
                onNewFolder?.(entry.path);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <FolderPlus size={14} />
            </Button>
          )}

          {manage && (
            <Button
              aria-label={`删除 ${entry.serverFilename}`}
              className="shrink-0 text-neutral-500 hover:text-red-400"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.(entry);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2 size={14} />
            </Button>
          )}

          {manage && entry.isDir && (
            <Button
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onImportFolder?.(entry);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              导入此文件夹
            </Button>
          )}
          {manage && isImage && lightboxIndex >= 0 && (
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

  const root = nodes[""];

  return (
    <>
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

      {mode === "manage" && viewing !== null && visibleImages[viewing] && (
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
    </>
  );
}
