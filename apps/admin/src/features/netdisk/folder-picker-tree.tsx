import type { BaiduFileEntry } from "@photo/shared";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";

/**
 * 树节点状态：某目录已加载的条目与分页。根目录的 key 是空串（服务端归一化
 * 到应用目录），其余 key 是服务端绝对路径。页面主树与新建文件夹弹框的
 * 父目录选择器共用同一份 nodes state。
 */
export interface NodeState {
  entries: BaiduFileEntry[];
  page: number;
  hasMore: boolean;
  expanded: boolean;
  loading: boolean;
}

interface FolderPickerTreeProps {
  /** 页面主树的目录状态（与主树共享；未加载目录点击时经 onFetchDir 懒加载）。 */
  nodes: Record<string, NodeState>;
  /** 当前选中的父目录（"" = 应用根，必须可选）。 */
  value: string;
  /** 应用根的服务端绝对路径（页面 rootDirRef.current），推导选中目录的祖先链用。 */
  rootDir: string;
  onChange: (dir: string) => void;
  /** 复用页面主树的目录加载逻辑（fetchIntoTree）。 */
  onFetchDir: (dir: string, page: number, append: boolean) => void;
}

/** 选中目录的祖先 key 链（不含根 ""）：应用根之下的各级绝对路径前缀。 */
function ancestorKeys(dir: string, rootDir: string): string[] {
  if (!dir || !rootDir || !dir.startsWith(`${rootDir}/`)) return [];
  const keys: string[] = [];
  const parts = dir.split("/");
  for (let i = 1; i < parts.length - 1; i++) {
    const prefix = parts.slice(0, i + 1).join("/");
    if (prefix.startsWith(`${rootDir}/`)) keys.push(prefix);
  }
  return keys;
}

/** 新建文件夹弹框内的父目录选择器：迷你目录树，点行选中、点箭头展开。 */
export function FolderPickerTree(props: FolderPickerTreeProps) {
  const { nodes, value, rootDir, onChange, onFetchDir } = props;
  // 选择器自己的展开状态（与主树的 expanded 互不影响）；根行常显、子级直接列出
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selectedRowRef = useRef<HTMLDivElement>(null);

  function dirsOf(dir: string): BaiduFileEntry[] {
    return (nodes[dir]?.entries ?? []).filter((entry) => entry.isDir);
  }

  function toggleExpand(dir: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
    // 未加载目录：复用页面加载逻辑懒加载（已有数据的目录不重拉，保住主树分页）
    const node = nodes[dir];
    if (!(node && node.page > 0) && !node?.loading) {
      onFetchDir(dir, 1, false);
    }
  }

  // 挂载时展开默认选中目录的祖先链，未加载的祖先顺手懒加载；
  // 并把选中行滚进可视区（选择器随弹框开关重挂载，此效果只跑一次）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载时初始化；nodes/onFetchDir/value 是闭包依赖，入数组会在每次加载后重跑
  useEffect(() => {
    const chain = ancestorKeys(value, rootDir);
    if (chain.length > 0) {
      setExpanded(new Set(chain));
      for (const key of chain) {
        const node = nodes[key];
        if (!(node && node.page > 0) && !node?.loading) {
          onFetchDir(key, 1, false);
        }
      }
    }
    requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  function renderRow(entry: BaiduFileEntry, depth: number): ReactNode {
    const node = nodes[entry.path];
    const isSelected = value === entry.path;
    const isExpanded = expanded.has(entry.path);
    const childDirs = dirsOf(entry.path);

    return (
      <div key={entry.path}>
        <div
          aria-label={`选择 ${entry.serverFilename}`}
          aria-selected={isSelected}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
            isSelected
              ? "bg-neutral-800 text-neutral-100"
              : "hover:bg-neutral-800/50"
          }`}
          onClick={() => onChange(entry.path)}
          onKeyDown={(event: ReactKeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onChange(entry.path);
            }
          }}
          ref={isSelected ? selectedRowRef : undefined}
          role="option"
          tabIndex={0}
        >
          <span className="shrink-0" style={{ width: depth * 16 }} />
          <button
            aria-label={
              isExpanded
                ? `收起 ${entry.serverFilename}`
                : `展开 ${entry.serverFilename}`
            }
            className="flex shrink-0 items-center text-neutral-500 hover:text-neutral-300"
            onClick={(event) => {
              event.stopPropagation();
              toggleExpand(entry.path);
            }}
            type="button"
          >
            {node?.loading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
          {isExpanded ? (
            <FolderOpen className="shrink-0 text-neutral-400" size={14} />
          ) : (
            <Folder className="shrink-0 text-neutral-400" size={14} />
          )}
          <span className="min-w-0 flex-1 truncate">
            {entry.serverFilename}
          </span>
        </div>

        {isExpanded && (
          <div>
            {childDirs.map((child) => renderRow(child, depth + 1))}
            {node &&
              node.page > 0 &&
              !node.loading &&
              childDirs.length === 0 &&
              !node.hasMore && (
                <p
                  className="py-1 text-xs text-neutral-600"
                  style={{ paddingLeft: depth * 16 + 44 }}
                >
                  无子文件夹
                </p>
              )}
            {node?.hasMore && node.page > 0 && (
              <Button
                className="h-auto py-1 text-xs"
                onClick={() => onFetchDir(entry.path, node.page + 1, true)}
                style={{ paddingLeft: depth * 16 + 44 }}
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

  const rootLoading = nodes[""]?.loading ?? false;
  const rootChildDirs = dirsOf("");

  return (
    <div
      aria-label="父目录"
      className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/40 p-1"
      role="listbox"
    >
      <div
        aria-label="选择应用目录"
        aria-selected={value === ""}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
          value === ""
            ? "bg-neutral-800 text-neutral-100"
            : "hover:bg-neutral-800/50"
        }`}
        onClick={() => onChange("")}
        onKeyDown={(event: ReactKeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onChange("");
          }
        }}
        ref={value === "" ? selectedRowRef : undefined}
        role="option"
        tabIndex={0}
      >
        <span className="shrink-0" style={{ width: 28 }} />
        {rootLoading ? (
          <Loader2
            className="shrink-0 animate-spin text-neutral-500"
            size={14}
          />
        ) : (
          <FolderOpen className="shrink-0 text-neutral-400" size={14} />
        )}
        <span className="min-w-0 flex-1 truncate">应用目录（根）</span>
      </div>

      {rootChildDirs.map((child) => renderRow(child, 0))}
      {rootLoading && rootChildDirs.length === 0 && (
        <p className="py-1 pl-11 text-xs text-neutral-600">加载中…</p>
      )}
      {nodes[""]?.hasMore && (nodes[""]?.page ?? 0) > 0 && (
        <Button
          className="h-auto py-1 pl-11 text-xs"
          onClick={() => onFetchDir("", (nodes[""]?.page ?? 1) + 1, true)}
          type="button"
          variant="ghost"
        >
          加载更多…
        </Button>
      )}
    </div>
  );
}
