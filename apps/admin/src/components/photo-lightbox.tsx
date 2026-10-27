import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect } from "react";

export interface LightboxPhoto {
  url: string | null;
  title: string | null;
  caption: string | null;
}

/** 照片灯箱：左右翻页、Esc/按钮/背景点击关闭。 */
export function PhotoLightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const prev = useCallback(
    () => onNavigate((index - 1 + photos.length) % photos.length),
    [index, onNavigate, photos.length],
  );
  const next = useCallback(
    () => onNavigate((index + 1) % photos.length),
    [index, onNavigate, photos.length],
  );

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") prev();
      if (event.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [next, onClose, prev]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 灯箱背景点击关闭是标准交互，关闭/翻页均有键盘替代
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={onClose}
      role="presentation"
    >
      <header className="flex items-center justify-between px-4 py-3 text-neutral-300 sm:px-6 sm:py-4">
        <span className="text-sm">
          {index + 1} / {photos.length}
        </span>
        <button
          aria-label="关闭"
          className="rounded-full border border-neutral-700 p-2 hover:border-neutral-400"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" size={16} />
        </button>
      </header>

      <div className="relative flex flex-1 items-center justify-center px-2 pb-4 sm:px-4 sm:pb-6">
        <button
          aria-label="上一张"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-neutral-700 p-2 text-neutral-300 hover:border-neutral-400 sm:left-4"
          onClick={(event) => {
            event.stopPropagation();
            prev();
          }}
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        {photo.url && (
          // biome-ignore lint/a11y/noStaticElementInteractions: 点击大图不关闭灯箱（阻止冒泡），关闭有按钮与 Esc
          // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
          <img
            alt={photo.title ?? "照片"}
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
            src={photo.url}
          />
        )}
        <button
          aria-label="下一张"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-neutral-700 p-2 text-neutral-300 hover:border-neutral-400 sm:right-4"
          onClick={(event) => {
            event.stopPropagation();
            next();
          }}
          type="button"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: 说明区点击不关闭灯箱（阻止冒泡） */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上；说明区不需要键盘交互 */}
      <footer
        className="space-y-1 px-4 pb-4 text-center text-sm text-neutral-400 sm:px-6 sm:pb-6"
        onClick={(event) => event.stopPropagation()}
      >
        {photo.title && (
          <p className="font-medium text-neutral-200">{photo.title}</p>
        )}
        {photo.caption && <p>{photo.caption}</p>}
      </footer>
    </div>
  );
}
