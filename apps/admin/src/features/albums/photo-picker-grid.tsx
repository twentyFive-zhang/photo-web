import type { Photo } from "@photo/shared";
import { Check, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { mediaUrl } from "@/lib/api";

function thumbUrl(photo: Photo): string | null {
  const thumb = photo.renditions.find((r) => r.variant === "THUMB");
  return thumb ? mediaUrl(thumb.key) : null;
}

/**
 * 照片库选择网格（ADR 0007 自 photo-picker-dialog 抽出复用）：
 * 按标题/publicId 搜索 + 勾选；已在专辑内的照片打勾不可再选。
 * 勾选状态与提交动作归调用方，这里只管展示与筛选。
 */
export function PhotoPickerGrid({
  photos,
  isLoading,
  memberIds,
  selected,
  onToggle,
}: {
  /** 照片库全量列表（新照片在前）。 */
  photos: Photo[];
  isLoading: boolean;
  /** 当前专辑成员 photoId 集合（打勾展示 + 不可再选）。 */
  memberIds: Set<string>;
  selected: Set<string>;
  onToggle: (photoId: string) => void;
}) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return photos;
    return photos.filter(
      (photo) =>
        (photo.title ?? "").toLowerCase().includes(kw) ||
        photo.publicId.toLowerCase().includes(kw),
    );
  }, [photos, keyword]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-500"
            size={14}
          />
          <Input
            className="pl-8"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按标题或 publicId 搜索"
            value={keyword}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-800">
        {isLoading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-neutral-400">
            <Loader2 className="animate-spin" size={14} />
            加载中…
          </p>
        ) : photos.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">
            照片库还是空的——先「上传到照片库」或从网盘导入。
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">没有匹配的照片。</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 p-2 sm:grid-cols-4">
            {filtered.map((photo) => {
              const isMember = memberIds.has(photo.id);
              const isSelected = selected.has(photo.id);
              const url = thumbUrl(photo);
              return (
                <li key={photo.id}>
                  <button
                    className={`group relative block w-full overflow-hidden rounded-lg border ${
                      isMember
                        ? "border-neutral-700 opacity-50"
                        : isSelected
                          ? "border-white"
                          : "border-neutral-800 hover:border-neutral-500"
                    }`}
                    disabled={isMember}
                    onClick={() => onToggle(photo.id)}
                    type="button"
                  >
                    {url ? (
                      // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                      <img
                        alt={photo.title ?? "照片"}
                        className="aspect-square w-full object-cover"
                        src={url}
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-xs text-neutral-600">
                        无预览
                      </div>
                    )}
                    {isMember && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check className="size-5 text-neutral-300" size={20} />
                      </span>
                    )}
                    {photo.title && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-0.5 text-left text-[11px] text-neutral-300">
                        {photo.title}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
