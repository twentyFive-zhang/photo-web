import { describe, expect, test } from "bun:test";
import { ConflictException } from "@nestjs/common";
import type { Job } from "bullmq";
import { ImportProcessor } from "./import.processor.js";

/**
 * ImportProcessor 附带专辑逻辑单测（ADR 0007 一步挂专辑）：
 * 依赖全部用手写假体注入，不碰数据库 / 网盘 / 队列。
 * 覆盖验收标准第 2 条的两例 + sha256 去重命中 + 未附带专辑的原语义。
 */

interface ItemUpdate {
  where: { id: string };
  data: Record<string, unknown>;
}

function makeProcessor(options: {
  albumId: string | null;
  /** createPhotoFromBuffer 的行为：返回照片或抛错。 */
  photoResult: { id: string } | Error;
  /** prisma.photo.findUnique（sha256 查重）返回值。 */
  duplicate: { id: string } | null;
  /** albumService.addPhotos 抛错（模拟专辑缺失/写入失败）。 */
  addPhotosError?: Error;
}) {
  const addPhotosCalls: Array<{ albumId: string; photoIds: string[] }> = [];
  const itemUpdates: ItemUpdate[] = [];

  const prisma = {
    importJob: {
      findUnique: async () => ({
        id: "job-1",
        albumId: options.albumId,
        items: [{ id: "item-1", status: "PENDING", sourceFileId: "12345" }],
      }),
      update: async () => ({}),
    },
    importItem: {
      updateMany: async () => ({ count: 0 }),
      update: async (args: ItemUpdate) => {
        itemUpdates.push(args);
        return {};
      },
      groupBy: async () => [],
    },
    photo: {
      update: async () => ({}),
      findUnique: async () => options.duplicate,
    },
  };
  const baiduDownload = {
    downloadByFsId: async () => ({
      buffer: Buffer.from("fake-image-bytes"),
      path: "/apps/app/library/abc.jpg",
    }),
  };
  const photoService = {
    createPhotoFromBuffer: async () => {
      if (options.photoResult instanceof Error) throw options.photoResult;
      return options.photoResult;
    },
  };
  const albumService = {
    addPhotos: async (albumId: string, input: { photoIds: string[] }) => {
      if (options.addPhotosError) throw options.addPhotosError;
      addPhotosCalls.push({ albumId, photoIds: input.photoIds });
    },
  };

  const processor = new ImportProcessor(
    prisma as never,
    baiduDownload as never,
    photoService as never,
    albumService as never,
  );
  const run = () =>
    processor.process({
      data: { importJobId: "job-1" },
    } as unknown as Job<{ importJobId: string }>);
  return { run, addPhotosCalls, itemUpdates };
}

function lastItemUpdate(updates: ItemUpdate[]): ItemUpdate["data"] {
  return updates[updates.length - 1]?.data ?? {};
}

describe("ImportProcessor 附带专辑（ADR 0007）", () => {
  test("附带专辑：成功产出照片后写入成员行，条目 SUCCEEDED", async () => {
    const { run, addPhotosCalls, itemUpdates } = makeProcessor({
      albumId: "album-1",
      photoResult: { id: "photo-new" },
      duplicate: null,
    });

    await expect(run()).resolves.toBeUndefined();

    expect(addPhotosCalls).toEqual([
      { albumId: "album-1", photoIds: ["photo-new"] },
    ]);
    expect(lastItemUpdate(itemUpdates)).toEqual({
      status: "SUCCEEDED",
      photoId: "photo-new",
    });
  });

  test("专辑中途被删：成员写入失败降级为仅入库，任务不判失败", async () => {
    const { run, addPhotosCalls, itemUpdates } = makeProcessor({
      albumId: "album-gone",
      photoResult: { id: "photo-new" },
      duplicate: null,
      addPhotosError: new Error("专辑不存在"),
    });

    // 不抛错 = 任务不失败；照片保留（SUCCEEDED）、无成员行
    await expect(run()).resolves.toBeUndefined();

    expect(addPhotosCalls).toEqual([]);
    expect(lastItemUpdate(itemUpdates)).toEqual({
      status: "SUCCEEDED",
      photoId: "photo-new",
    });
  });

  test("附带专辑 + sha256 去重命中：把已存在的旧照片纳入专辑", async () => {
    const { run, addPhotosCalls, itemUpdates } = makeProcessor({
      albumId: "album-1",
      photoResult: new ConflictException("相同内容的照片已存在"),
      duplicate: { id: "photo-existing" },
    });

    await expect(run()).resolves.toBeUndefined();

    expect(addPhotosCalls).toEqual([
      { albumId: "album-1", photoIds: ["photo-existing"] },
    ]);
    expect(lastItemUpdate(itemUpdates)).toEqual({
      status: "SUCCEEDED",
      photoId: "photo-existing",
    });
  });

  test("未附带专辑：去重命中维持 SKIPPED 原语义，不写成员行", async () => {
    const { run, addPhotosCalls, itemUpdates } = makeProcessor({
      albumId: null,
      photoResult: new ConflictException("相同内容的照片已存在"),
      duplicate: { id: "photo-existing" },
    });

    await expect(run()).resolves.toBeUndefined();

    expect(addPhotosCalls).toEqual([]);
    expect(lastItemUpdate(itemUpdates)).toEqual({
      status: "SKIPPED",
      error: "相同内容的照片已存在，自动跳过",
    });
  });
});
