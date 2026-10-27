const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** 服务端请求 API（SSR）。页面使用 connection() 保持动态渲染。 */
export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase}/api${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`API 请求失败：${path}（HTTP ${res.status}）`);
  }
  return (await res.json()) as T;
}
