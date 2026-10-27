import { Injectable, UnsupportedMediaTypeException } from "@nestjs/common";
import type { PhotoVariant } from "@photo/shared";
import exifr from "exifr";
import sharp from "sharp";

/** 单文件上传上限：50MB。 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const ORIGINAL_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** 三档展示图宽度（等比缩放，不放大）。 */
const RENDITION_WIDTHS: Record<PhotoVariant, number> = {
  THUMB: 400,
  DISPLAY: 1600,
  LARGE: 2560,
};

export interface OriginalImage {
  width: number;
  height: number;
  ext: string;
}

export interface GeneratedRendition {
  variant: PhotoVariant;
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
}

/** 结构化 EXIF（展示用，无 GPS）。 */
export interface PhotoExif {
  camera: string | null;
  lens: string | null;
  aperture: string | null;
  shutter: string | null;
  iso: number | null;
  focalLength: string | null;
  shotAt: string | null;
}

function formatShutter(seconds: number): string {
  if (seconds >= 1) {
    return `${Number(seconds.toFixed(1))}s`;
  }
  return `1/${Math.round(1 / seconds)}`;
}

@Injectable()
export class PhotoProcessingService {
  assertUploadable(mimetype: string, size: number): void {
    if (!ALLOWED_MIME.has(mimetype)) {
      throw new UnsupportedMediaTypeException(
        "仅支持 JPEG / PNG / WebP（HEIC 转换将在后续里程碑支持）",
      );
    }
    if (size > MAX_UPLOAD_BYTES) {
      throw new UnsupportedMediaTypeException("文件超过 50MB 上限");
    }
  }

  /** 原图尺寸；EXIF 方向标记会交换宽高。 */
  async readOriginal(buffer: Buffer): Promise<OriginalImage> {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new UnsupportedMediaTypeException("无法解析图片尺寸");
    }
    // orientation 5-8 表示旋转 90°，宽高互换
    const swapped = (metadata.orientation ?? 1) >= 5;
    return {
      width: swapped ? metadata.height : metadata.width,
      height: swapped ? metadata.width : metadata.height,
      ext:
        ORIGINAL_EXT[metadata.format ? `image/${metadata.format}` : ""] ??
        "jpg",
    };
  }

  /** 生成三档 WebP；rotate() 按 EXIF 方向自动转正。 */
  async generateRenditions(buffer: Buffer): Promise<GeneratedRendition[]> {
    const base = sharp(buffer, { failOn: "error" }).rotate();
    const variants: PhotoVariant[] = ["THUMB", "DISPLAY", "LARGE"];
    return Promise.all(
      variants.map(async (variant) => {
        const { data, info } = await base
          .clone()
          .resize({
            width: RENDITION_WIDTHS[variant],
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        return {
          variant,
          buffer: data,
          width: info.width,
          height: info.height,
          bytes: data.byteLength,
        };
      }),
    );
  }

  /** 提取展示用 EXIF；只取白名单字段，GPS 不读取不落库。 */
  async extractExif(buffer: Buffer): Promise<PhotoExif | null> {
    const parsed = await exifr.parse(buffer, {
      pick: [
        "Make",
        "Model",
        "LensModel",
        "FNumber",
        "ExposureTime",
        "ISO",
        "FocalLength",
        "DateTimeOriginal",
      ],
    });
    if (!parsed) {
      return null;
    }

    const camera = [parsed.Make, parsed.Model]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join(" ")
      .trim();

    return {
      camera: camera || null,
      lens: typeof parsed.LensModel === "string" ? parsed.LensModel : null,
      aperture:
        typeof parsed.FNumber === "number" ? `f/${parsed.FNumber}` : null,
      shutter:
        typeof parsed.ExposureTime === "number"
          ? formatShutter(parsed.ExposureTime)
          : null,
      iso: typeof parsed.ISO === "number" ? parsed.ISO : null,
      focalLength:
        typeof parsed.FocalLength === "number"
          ? `${Math.round(parsed.FocalLength)}mm`
          : null,
      shotAt:
        parsed.DateTimeOriginal instanceof Date
          ? parsed.DateTimeOriginal.toISOString()
          : null,
    };
  }
}
