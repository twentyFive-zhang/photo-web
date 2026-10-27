import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FolderOpen, LogOut, Settings, Smartphone, Star } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AdminQrDialog } from "../features/albums/qr-dialog.jsx";
import { apiFetch } from "./api.js";

export function useLogoutMutation() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });
}

/** 后台页骨架：顶部导航（专辑 / 精选 / 设置）+ 手机管理 + 登出。 */
export function AdminShell({ children }: { children: ReactNode }) {
  const logout = useLogoutMutation();
  const [showPhoneQr, setShowPhoneQr] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8 sm:py-4">
          <nav className="flex gap-4 sm:gap-6">
            <Link
              className="flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white"
              to="/albums"
            >
              <FolderOpen size={15} />
              专辑
            </Link>
            <Link
              className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"
              to="/featured"
            >
              <Star size={15} />
              精选
            </Link>
            <Link
              className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"
              to="/settings"
            >
              <Settings size={15} />
              站点设置
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <button
              className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white"
              onClick={() => setShowPhoneQr(true)}
              type="button"
            >
              <Smartphone size={15} />
              手机管理
            </button>
            <button
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-white"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
              type="button"
            >
              <LogOut size={15} />
              退出登录
            </button>
          </div>
        </div>
      </header>
      {children}
      {showPhoneQr && <AdminQrDialog onClose={() => setShowPhoneQr(false)} />}
    </div>
  );
}

/** GET /admin/albums/:id/photos 的行结构。 */
export interface AlbumPhotoRow {
  id: string;
  publicId: string;
  title: string | null;
  caption: string | null;
  width: number;
  height: number;
  exif: Record<string, unknown> | null;
  tags: { id: string; name: string }[];
  renditions: {
    variant: "THUMB" | "DISPLAY" | "LARGE";
    format: string;
    key: string;
    width: number;
    height: number;
  }[];
}

export function useInvalidateAlbum(albumId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["album", albumId] });
    queryClient.invalidateQueries({ queryKey: ["album-photos", albumId] });
    queryClient.invalidateQueries({ queryKey: ["albums"] });
    queryClient.invalidateQueries({ queryKey: ["featured"] });
  };
}

/** 当前精选的 photoId 集合。 */
export function useFeaturedIds() {
  const query = useQuery({
    queryKey: ["featured"],
    queryFn: () => apiFetch<{ photoId: string }[]>("/admin/featured"),
  });
  return new Set(query.data?.map((item) => item.photoId) ?? []);
}
