import type { ImportJob } from "@photo/shared";

/** 有活跃任务时的高频轮询间隔。 */
export const ACTIVE_POLL_INTERVAL_MS = 2_000;

/** 连续失败达到该次数后暂停高频轮询，退避为慢速探测。 */
export const POLL_FAILURE_THRESHOLD = 3;

/** 退避探测间隔：只做恢复探测，任一次成功即回到正常轮询节奏。 */
export const PROBE_INTERVAL_MS = 60_000;

/** 仍视为「进行中」的导入任务状态。 */
export const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

/**
 * 导入横幅的下次轮询间隔（纯函数，便于单测）。判定依据是缓存中
 * 上次成功的数据——请求失败时 react-query 会保留它，因此这里
 * 不能只看数据、还得看连续失败次数，否则接口持续报错时会形成
 * 每 2s 一次、永不停止的请求风暴（JIANGLIUER-136）：
 * - 缓存数据里没有活跃任务 → false，完全停止轮询（终态语义不变）；
 * - 有活跃任务但连续失败 ≥ 阈值 → 退避为慢速探测，暂停 2s 高频轮询；
 *   react-query 的 fetchFailureCount 在任一次成功后归零，服务恢复即自动续上。
 */
export function nextImportPollInterval(
  jobs: readonly ImportJob[] | undefined,
  failureCount: number,
): number | false {
  const hasActive = (jobs ?? []).some((job) => ACTIVE_STATUSES.has(job.status));
  if (!hasActive) {
    return false;
  }
  return failureCount >= POLL_FAILURE_THRESHOLD
    ? PROBE_INTERVAL_MS
    : ACTIVE_POLL_INTERVAL_MS;
}
