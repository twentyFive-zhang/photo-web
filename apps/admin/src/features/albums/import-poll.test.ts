import { describe, expect, test } from "bun:test";
import type { ImportJob, ImportJobStatus } from "@photo/shared";
import {
  ACTIVE_POLL_INTERVAL_MS,
  createImportPollTimer,
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

describe("createImportPollTimer", () => {
  test("连续失败 3 次后退避，退避中仍失败维持 60s，任一次成功恢复 2s", () => {
    const tick = createImportPollTimer();
    const running = [makeJob("RUNNING")];
    // 首次成功加载：2s 轮询
    expect(tick({ data: running, errorUpdatedAt: 0, dataUpdatedAt: 100 })).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
    // 连续失败（errorUpdatedAt 推进）：前 2 次仍 2s
    expect(
      tick({ data: running, errorUpdatedAt: 200, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(
      tick({ data: running, errorUpdatedAt: 300, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    // 第 3 次失败 → 退避
    expect(
      tick({ data: running, errorUpdatedAt: 400, dataUpdatedAt: 100 }),
    ).toBe(PROBE_INTERVAL_MS);
    // 退避探测仍失败 → 维持 60s
    expect(
      tick({ data: running, errorUpdatedAt: 500, dataUpdatedAt: 100 }),
    ).toBe(PROBE_INTERVAL_MS);
    // 任一次成功（dataUpdatedAt 推进）→ 计数归零 → 恢复 2s
    expect(
      tick({ data: running, errorUpdatedAt: 500, dataUpdatedAt: 600 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
  });

  test("退避中探测成功且任务已终态 → 完全停止轮询", () => {
    const tick = createImportPollTimer();
    const running = [makeJob("RUNNING")];
    expect(tick({ data: running, errorUpdatedAt: 0, dataUpdatedAt: 100 })).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
    expect(
      tick({ data: running, errorUpdatedAt: 200, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(
      tick({ data: running, errorUpdatedAt: 300, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(
      tick({ data: running, errorUpdatedAt: 400, dataUpdatedAt: 100 }),
    ).toBe(PROBE_INTERVAL_MS);
    // 退避探测成功，返回数据显示任务已终态 → false
    expect(
      tick({
        data: [makeJob("SUCCEEDED")],
        errorUpdatedAt: 400,
        dataUpdatedAt: 500,
      }),
    ).toBe(false);
  });

  test("状态未推进的重复回调（fetch 开始等）不重复计数", () => {
    const tick = createImportPollTimer();
    const running = [makeJob("RUNNING")];
    expect(tick({ data: running, errorUpdatedAt: 0, dataUpdatedAt: 100 })).toBe(
      ACTIVE_POLL_INTERVAL_MS,
    );
    expect(
      tick({ data: running, errorUpdatedAt: 200, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    // 同一 errorUpdatedAt 重复回调（fetch 开始等状态变化）不累计
    expect(
      tick({ data: running, errorUpdatedAt: 200, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(
      tick({ data: running, errorUpdatedAt: 300, dataUpdatedAt: 100 }),
    ).toBe(ACTIVE_POLL_INTERVAL_MS);
    // 仍是第 3 次失败才退避
    expect(
      tick({ data: running, errorUpdatedAt: 400, dataUpdatedAt: 100 }),
    ).toBe(PROBE_INTERVAL_MS);
  });
});
