import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { AlbumDetailPage } from "./features/albums/album-detail-page";
import { AlbumsPage } from "./features/albums/albums-page";
import { LoginPage, RequireAuth } from "./features/auth/login-page";
import { FeaturedPage } from "./features/featured/featured-page";
import { NetdiskPage } from "./features/netdisk/netdisk-page";
import { SettingsPage } from "./features/settings/settings-page";
import "./index.css";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/albums" />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const albumsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/albums",
  component: () => (
    <RequireAuth>
      <AlbumsPage />
    </RequireAuth>
  ),
});

const albumDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/albums/$albumId",
  component: () => (
    <RequireAuth>
      <AlbumDetailPage />
    </RequireAuth>
  ),
});

const featuredRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/featured",
  component: () => (
    <RequireAuth>
      <FeaturedPage />
    </RequireAuth>
  ),
});

const netdiskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/netdisk",
  component: () => (
    <RequireAuth>
      <NetdiskPage />
    </RequireAuth>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => (
    <RequireAuth>
      <SettingsPage />
    </RequireAuth>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  albumsRoute,
  albumDetailRoute,
  featuredRoute,
  netdiskRoute,
  settingsRoute,
]);

const router = createRouter({
  routeTree,
  basepath: "/admin",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* 接口操作的成功/失败提示；移动端居中更易看到 */}
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  </StrictMode>,
);
