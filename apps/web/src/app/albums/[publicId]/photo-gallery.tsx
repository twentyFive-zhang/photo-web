"use client";

import type { PublicPhoto } from "@photo/shared";
import { useCallback, useEffect, useState } from "react";

function renditionUrl(
  photo: PublicPhoto,
  variant: "THUMB" | "DISPLAY" | "LARGE",
): string | null {
  return photo.renditions.find((r) => r.variant === variant)?.url ?? null;
}

function exifLine(photo: PublicPhoto): string | null {
  const exif = photo.exif as Record<string, unknown> | null;
  if (!exif) return null;
  const parts = [
    exif.camera,
    exif.lens,
    exif.focalLength,
    exif.aperture,
    exif.shutter,
    typeof exif.iso === "number" ? `ISO ${exif.iso}` : null,
  ].filter((part): part is string => typeof part === "string" && part !== "");
  return parts.join(" · ") || null;
}

export function PhotoGallery({ photos }: { photos: PublicPhoto[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const close = useCallback(() => setSelectedIndex(null), []);
  const prev = useCallback(
    () =>
      setSelectedIndex((index) =>
        index === null ? null : (index - 1 + photos.length) % photos.length,
      ),
    [photos.length],
  );
  const next = useCallback(
    () =>
      setSelectedIndex((index) =>
        index === null ? null : (index + 1) % photos.length,
      ),
    [photos.length],
  );

  useEffect(() => {
    if (selectedIndex === null) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") prev();
      if (event.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [close, next, prev, selectedIndex]);

  const selected = selectedIndex === null ? null : photos[selectedIndex];

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((photo, index) => {
          const thumb = renditionUrl(photo, "THUMB");
          return (
            <li key={photo.publicId}>
              <button
                className="block w-full overflow-hidden rounded-xl bg-neutral-900"
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                {thumb && (
                  // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                  <img
                    alt={photo.title ?? "照片"}
                    className="aspect-square w-full object-cover transition-opacity hover:opacity-80"
                    loading="lazy"
                    src={thumb}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 灯箱背景点击关闭是标准交互，关闭/翻页均有键盘替代
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={close}
          role="presentation"
        >
          <header className="flex items-center justify-between px-6 py-4 text-neutral-300">
            <span className="text-sm">
              {(selectedIndex ?? 0) + 1} / {photos.length}
            </span>
            <button
              aria-label="关闭"
              className="rounded-full border border-neutral-700 px-3 py-1 text-sm hover:border-neutral-400"
              onClick={close}
              type="button"
            >
              关闭 (Esc)
            </button>
          </header>

          <div className="relative flex flex-1 items-center justify-center px-4 pb-6">
            <button
              aria-label="上一张"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-neutral-700 px-3 py-2 text-neutral-300 hover:border-neutral-400"
              onClick={(event) => {
                event.stopPropagation();
                prev();
              }}
              type="button"
            >
              ←
            </button>
            {(() => {
              const large = renditionUrl(selected, "LARGE");
              return large ? (
                // biome-ignore lint/a11y/noStaticElementInteractions: 点击大图不关闭灯箱（阻止冒泡），关闭有按钮与 Esc
                // biome-ignore lint/performance/noImgElement: 图 URL 来自 API rendition（本地 /media），不走 next/image 优化
                <img
                  alt={selected.title ?? "照片"}
                  className="max-h-full max-w-full object-contain"
                  onClick={(event) => event.stopPropagation()}
                  role="presentation"
                  src={large}
                />
              ) : null;
            })()}
            <button
              aria-label="下一张"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-neutral-700 px-3 py-2 text-neutral-300 hover:border-neutral-400"
              onClick={(event) => {
                event.stopPropagation();
                next();
              }}
              type="button"
            >
              →
            </button>
          </div>

          {/* biome-ignore lint/a11y/noStaticElementInteractions: 说明区点击不关闭灯箱（阻止冒泡），关闭有按钮与 Esc */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上；说明区不需要键盘交互 */}
          <footer
            className="space-y-1 px-6 pb-6 text-center text-sm text-neutral-400"
            onClick={(event) => event.stopPropagation()}
          >
            {selected.title && (
              <p className="font-medium text-neutral-200">{selected.title}</p>
            )}
            {exifLine(selected) && <p>{exifLine(selected)}</p>}
            {selected.caption && <p>{selected.caption}</p>}
          </footer>
        </div>
      )}
    </>
  );
}
