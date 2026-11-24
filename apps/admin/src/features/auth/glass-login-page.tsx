import { zodResolver } from "@hookform/resolvers/zod";
import { type LoginInput, loginInputSchema } from "@photo/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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

/**
 * break-glass 应急登录（仅本地应急账号可用；常规登录一律走统一登录）。
 * 隐蔽入口：/admin/login/glass —— 不在界面上放链接，靠人工输入地址进入。
 */
export function GlassLoginPage() {
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
            <h1 className="text-xl font-medium">应急登录</h1>
            <p className="text-sm text-neutral-500">
              仅应急使用——身份源不可用时的本地通道，只对预留的应急账号开放。
              日常登录请用统一登录。
            </p>
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
            {loginMutation.isPending ? "登录中…" : "应急登录"}
          </Button>

          <p className="text-center text-xs text-neutral-600">
            <a href="/admin/login" className="hover:text-neutral-400">
              返回统一登录
            </a>
          </p>
        </form>
      </Form>
    </main>
  );
}
