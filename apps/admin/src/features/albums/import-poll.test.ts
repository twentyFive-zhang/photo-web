import { describe, expect, test } from "bun:test";
import type { ImportJob, ImportJobStatus } from "@photo/shared";
import {
  ACTIVE_POLL_INTERVAL_MS,
  nextImportPollInterval,
  PROBE_INTERVAL_MS,
} from "./import-poll";

/**
 * 导入横幅轮询节奏单测（JIANGLIUER-136）：接口持续报错时不能形成
 * 2s 永不停歇的请求风暴——连续失败达阈值退避探测，成功自动续上，
 * 终态任务保持完全停止。
 */

function makeJob(status: ImportJobStatus, id = "job-1"): ImportJob {
  return {
    id,
    source: "BAIDU",
    status,
    total: 2,
    completed: 0,
    failed: 0,
    skipped: 0,
    error: null,
    items: [],
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
  };
}

describe("nextImportPollInterval", () => {
  test("活跃任务正常轮询（QUEUED/RUNNING → 2s）", () => {
    expect(nextImportPollInterval([makeJob("QUEUED")], 0)).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
    expect(nextImportPollInterval([makeJob("RUNNING")], 0)).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
  });

  test("连续失败未达阈值仍保持 2s 轮询", () => {
    expect(nextImportPollInterval([makeJob("RUNNING")], 1)).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
    expect(nextImportPollInterval([makeJob("RUNNING")], 2)).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
  });

  test("连续失败达阈值退避为慢速探测（不再 2s 打接口）", () => {
    expect(nextImportPollInterval([makeJob("RUNNING")], 3)).toBe(
      PROBE_INTERVAL_MS,
    );
    expect(nextImportPollInterval([makeJob("RUNNING")], 10)).toBe(
      PROBE_INTERVAL_MS,
    );
    expect(nextImportPollInterval([makeJob("QUEUED")], 3)).toBe(
      PROBE_INTERVAL_MS,
    );
  });

  test("终态任务停止轮询——即使此前连续失败", () => {
    for (const status of ["SUCCEEDED", "PARTIAL", "FAILED"] as const) {
      expect(nextImportPollInterval([makeJob(status)], 0)).toBe(false);
      expect(nextImportPollInterval([makeJob(status)], 10)).toBe(false);
    }
  });

  test("无数据或空列表不轮询（含首次加载即失败的场景）", () => {
    expect(nextImportPollInterval(undefined, 0)).toBe(false);
    expect(nextImportPollInterval(undefined, 10)).toBe(false);
    expect(nextImportPollInterval([], 10)).toBe(false);
  });

  test("列表中任一活跃任务即维持轮询（旧语义：看最近 5 个任务）", () => {
    const jobs = [
      makeJob("SUCCEEDED", "job-old"),
      makeJob("RUNNING", "job-new"),
    ];
    expect(nextImportPollInterval(jobs, 0)).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(nextImportPollInterval(jobs, 3)).toBe(PROBE_INTERVAL_MS);
  });
});
