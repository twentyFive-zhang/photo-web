import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: AdminHome,
});

const routeTree = rootRoute.addChildren([indexRoute]);

const router = createRouter({
  routeTree,
  basepath: "/admin",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const siteUrl = import.meta.env.VITE_SITE_URL ?? "http://localhost:3000";

function AdminHome() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <section className="w-full max-w-xl space-y-4">
        <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
          江流儿摄影
        </p>
        <h1 className="text-3xl font-medium tracking-tight">后台管理</h1>
        <p className="text-neutral-400">
          骨架已就绪。下一步接入登录、专辑和照片管理。
        </p>
        <div className="flex flex-wrap gap-3 pt-4">
          <a
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
            href={siteUrl}
          >
            查看前台
          </a>
          <a
            className="rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-400"
            href="/api/health"
          >
            API 健康检查
          </a>
        </div>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
