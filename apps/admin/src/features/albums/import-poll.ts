import type { ImportJob, ImportJobStatus } from "@photo/shared";

/** 有活跃任务时的高频轮询间隔。 */
export const ACTIVE_POLL_INTERVAL_MS = 2_000;

/** 连续失败达到该次数后暂停高频轮询，退避为慢速探测。 */
export const POLL_FAILURE_THRESHOLD = 3;

/** 退避探测间隔：只做恢复探测，任一次成功即回到正常轮询节奏。 */
export const PROBE_INTERVAL_MS = 60_000;

/** 仍视为「进行中」的导入任务状态。 */
export const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

/** 已到「不再推进」的导入任务终态。 */
export const TERMINAL_JOB_STATUSES = new Set<ImportJobStatus>([
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
]);

/** 终态判定所需的最小任务快照（ImportJob 结构化子集，便于单测构造）。 */
export interface ImportTerminalSnapshot {
  id: string;
  status: ImportJobStatus;
  /** 附带专辑（ADR 0007）：非空表示导入成功后照片自动纳入该专辑。 */
  albumId: string | null;
}

/**
 * 任务进入终态时需要失效的专辑查询键（纯函数，便于单测）。
 * 只有附带专辑的任务才影响专辑数据——未附带时导入只产照片，
 * 专辑成员不变，无需失效；albumId 为空或未到终态返回空数组。
 */
export function albumKeysToInvalidateOnTerminal(
  job: ImportTerminalSnapshot,
): string[][] {
  if (!TERMINAL_JOB_STATUSES.has(job.status) || job.albumId === null) {
    return [];
  }
  return [["album", job.albumId], ["album-photos", job.albumId], ["albums"]];
}

/**
 * 终态失效触发器（闭包式，跨横幅重挂载保持）：按「jobId + status」
 * 翻转触发一次，状态未推进的重复轮询不重复失效；重试把任务打回
 * QUEUED 再到终态时视为新的翻转，再次失效（重试可能补入新成员）。
 */
export function createTerminalInvalidator(): (
  job: ImportTerminalSnapshot,
) => string[][] {
  let lastKey: string | null = null;
  return (job) => {
    const key = `${job.id}:${job.status}`;
    if (lastKey === key) {
      return [];
    }
    lastKey = key;
    return albumKeysToInvalidateOnTerminal(job);
  };
}

/**
 * 导入横幅的下次轮询间隔（纯函数，便于单测）。判定依据是缓存中
 * 上次成功的数据——请求失败时 react-query 会保留它，因此这里
 * 不能只看数据、还得看连续失败次数，否则接口持续报错时会形成
 * 每 2s 一次、永不停止的请求风暴（JIANGLIUER-136）：
 * - 缓存数据里没有活跃任务 → false，完全停止轮询（终态语义不变）；
 * - 有活跃任务但连续失败 ≥ 阈值 → 退避为慢速探测，暂停 2s 高频轮询；
 *   连续失败计数由 createImportPollTimer 维护，任一次成功即归零，服务恢复自动续上。
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

/** 决策所需的查询状态快照（字段与 react-query 的 QueryState 同名，可直接传 query.state）。 */
export interface ImportPollSnapshot {
  /** 最近一次成功的数据（失败时 react-query 保留旧 data）。 */
  data: readonly ImportJob[] | undefined;
  /** 最近一次失败完成的时间戳（0 表示从未失败）。 */
  errorUpdatedAt: number;
  /** 最近一次成功完成的时间戳。 */
  dataUpdatedAt: number;
}

/**
 * 由查询状态推算「连续失败次数」，再交给 nextImportPollInterval 决策。
 * 不能直接用 query-core v5 的 fetchFailureCount：它在每次新 fetch 开始时
 * 都会被清零（query-core fetchState()），失败轮询永远停在个位数、跨轮询
 * 不累计，退避永远不会触发；故按 dataUpdatedAt / errorUpdatedAt 是否推进
 * 自行计数。一次回调里两者都推进（失败后紧跟成功）时以成功为准归零。
 */
export function createImportPollTimer(): (
  snapshot: ImportPollSnapshot,
) => number | false {
  let consecutiveFailures = 0;
  let seenErrorAt = 0;
  let seenDataAt = 0;
  return ({ data, errorUpdatedAt, dataUpdatedAt }) => {
    if (errorUpdatedAt > seenErrorAt) {
      seenErrorAt = errorUpdatedAt;
      consecutiveFailures += 1;
    }
    if (dataUpdatedAt > seenDataAt) {
      seenDataAt = dataUpdatedAt;
      consecutiveFailures = 0;
    }
    return nextImportPollInterval(data, consecutiveFailures);
  };
}
