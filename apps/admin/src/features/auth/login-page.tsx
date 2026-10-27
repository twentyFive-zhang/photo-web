import type { Admin, LoginInput } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api.js";

export function useMeQuery() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Admin>("/auth/me"),
    retry: false,
  });
}

/** 登录守卫：/auth/me 401 时跳转登录页。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const query = useMeQuery();
  if (query.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center text-neutral-400">
        加载中…
      </main>
    );
  }
  if (query.isError) {
    return <Navigate to="/login" />;
  }
  return children;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<void>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/albums" });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "登录失败，请重试");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    loginMutation.mutate({ username, password });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-800 p-8"
        onSubmit={handleSubmit}
      >
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">
            江流儿摄影
          </p>
          <h1 className="text-xl font-medium">后台登录</h1>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm text-neutral-400">用户名</span>
          <input
            autoComplete="username"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-neutral-400">密码</span>
          <input
            autoComplete="current-password"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          className="w-full rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          disabled={loginMutation.isPending}
          type="submit"
        >
          {loginMutation.isPending ? "登录中…" : "登录"}
        </button>
      </form>
    </main>
  );
}
