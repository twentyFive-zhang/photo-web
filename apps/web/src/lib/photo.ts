import type { PublicPhoto } from "@photo/shared";

export function renditionUrl(
  photo: PublicPhoto,
  variant: "THUMB" | "DISPLAY" | "LARGE",
): string | null {
  return photo.renditions.find((r) => r.variant === variant)?.url ?? null;
}

export function exifLine(photo: PublicPhoto): string | null {
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
