import { zodResolver } from "@hookform/resolvers/zod";
import { type Admin, type LoginInput, loginInputSchema } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api";

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
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { username: "", password: "" },
  });

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
      setServerError(
        err instanceof ApiError ? err.message : "登录失败，请重试",
      );
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Form {...form}>
        <form
          className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-800 p-8"
          onSubmit={form.handleSubmit((values) => {
            setServerError(null);
            loginMutation.mutate(values);
          })}
        >
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">
              江流儿摄影
            </p>
            <h1 className="text-xl font-medium">后台登录</h1>
          </div>

          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>用户名</FormLabel>
                <FormControl>
                  <Input autoComplete="username" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>密码</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="current-password"
                    type="password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {serverError && <p className="text-sm text-red-400">{serverError}</p>}

          <Button
            className="w-full"
            disabled={loginMutation.isPending}
            type="submit"
          >
            {loginMutation.isPending ? "登录中…" : "登录"}
          </Button>
        </form>
      </Form>
    </main>
  );
}
