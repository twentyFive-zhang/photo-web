export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 统一 API 客户端：走 vite proxy（/api → API），带 session cookie。 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    ...(isFormData
      ? {}
      : { headers: { "content-type": "application/json", ...init?.headers } }),
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : null;

  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ??
      `请求失败（HTTP ${res.status}）`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** rendition key → 本地媒体 URL（dev 走 vite proxy，生产同域 /media）。 */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}
