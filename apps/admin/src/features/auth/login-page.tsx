import type { Admin } from "@photo/shared";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

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

/** 统一登录：整页跳转 /api/auth/login（fetch 跟随不了跨域 302，必须浏览器导航）。 */
export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-neutral-800 p-8 text-center">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">
            江流儿摄影
          </p>
          <h1 className="text-xl font-medium">后台登录</h1>
          <p className="text-sm text-neutral-500">
            账号密码由统一身份源管理（id.localhost）
          </p>
        </div>

        <Button
          className="w-full"
          type="button"
          onClick={() => {
            window.location.assign("/api/auth/login");
          }}
        >
          统一登录
        </Button>
      </div>
    </main>
  );
}
