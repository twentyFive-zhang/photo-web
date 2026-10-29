import type {
  NetdiskScanTriggered,
  NetdiskStatus,
  SiteSetting,
} from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cloud,
  Plus,
  QrCode,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { apiFetch, mediaUrl } from "../../lib/api";
import { AdminShell } from "../../lib/shell";

interface SocialLinkDraft {
  label: string;
  url: string;
}

/** 表单内行状态：带稳定 key（数组 index 不能作 React key）。 */
interface SocialLinkRow extends SocialLinkDraft {
  key: string;
}

export function SettingsPage() {
  return (
    <AdminShell>
      <SettingsForm />
    </AdminShell>
  );
}

function SettingsForm() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SiteSetting>("/admin/settings"),
  });

  const updateMutation = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiFetch<SiteSetting>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setSaved(true);
      toast.success("站点设置已保存");
      setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  const qrMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<SiteSetting>("/admin/settings/qr", {
        method: "PUT",
        body: form,
      });
    },
    onSuccess: () => {
      toast.success("微信二维码已更新");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  if (settingsQuery.isPending) {
    return <p className="p-8 text-neutral-400">加载中…</p>;
  }
  const settings = settingsQuery.data;
  if (!settings) return null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 p-4 sm:p-8">
      <h1 className="flex items-center gap-2 text-2xl font-medium">
        <SettingsIcon size={22} />
        站点设置
      </h1>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <BasicSection
        settings={settings}
        onSave={(input) => updateMutation.mutate(input)}
      />
      <SocialLinksSection
        initial={settings.socialLinks}
        onSave={(socialLinks) => updateMutation.mutate({ socialLinks })}
      />
      <QrSection
        qrUrl={settings.wechatQrKey ? mediaUrl(settings.wechatQrKey) : null}
        onUpload={qrMutation.mutate}
        uploading={qrMutation.isPending}
      />
      <NetdiskSection
        onToggleDailyScan={(dailyScan) => updateMutation.mutate({ dailyScan })}
      />

      {saved && <p className="text-sm text-green-400">已保存</p>}
    </main>
  );
}

function NetdiskSection({
  onToggleDailyScan,
}: {
  onToggleDailyScan: (dailyScan: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["netdisk-status"];

  const statusQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<NetdiskStatus>("/admin/netdisk/status"),
    // 扫描进行中或还有未同步照片时轮询进度
    refetchInterval: (query) => {
      const status = query.state.data;
      if (status?.scanReport?.status === "RUNNING") return 3000;
      if (status && status.syncedCount < status.totalPhotos) return 5000;
      return false;
    },
  });

  const scanMutation = useMutation({
    mutationFn: () =>
      apiFetch<NetdiskScanTriggered>("/admin/netdisk/scan", {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("扫描已开始");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err.message),
  });

  const pushAllMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ queued: number }>("/admin/netdisk/push-all", {
        method: "POST",
      }),
    onSuccess: (data) => {
      toast.success(`已入队 ${data.queued} 张照片推送`);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () =>
      apiFetch<void>("/admin/baidu/disconnect", { method: "POST" }),
    onSuccess: () => {
      toast.success("已断开百度网盘");
      queryClient.invalidateQueries({ queryKey: ["baidu-status"] });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err.message),
  });

  const confirmDeleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/admin/netdisk/pending-deletes/${id}/confirm`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("网盘文件已删除");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err.message),
  });

  const dismissDeleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/admin/netdisk/pending-deletes/${id}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("已保留网盘副本");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err.message),
  });

  const status = statusQuery.data;
  const report = status?.scanReport;
  const pushing =
    status !== undefined && status.syncedCount < status.totalPhotos;

  return (
    <section className="space-y-4 rounded-2xl border border-neutral-800 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-300">
        <Cloud size={15} />
        百度网盘镜像同步
      </h2>

      {!status ? (
        <p className="text-sm text-neutral-500">加载中…</p>
      ) : !status.appConfigured ? (
        <p className="text-sm text-neutral-500">
          尚未配置百度应用（.env 缺 BAIDU_* 凭证），见 docs/PROJECT.md
          申请步骤。
        </p>
      ) : !status.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-neutral-500">未连接网盘。</p>
          <a
            className="inline-block rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
            href="/api/admin/baidu/authorize"
          >
            连接百度网盘
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">
            已连接 · 已同步 {status.syncedCount} / {status.totalPhotos} 张
            {pushing && "（推送中…）"}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400 disabled:opacity-50"
              disabled={scanMutation.isPending || report?.status === "RUNNING"}
              onClick={() => scanMutation.mutate()}
              type="button"
            >
              <RefreshCw size={14} />
              {report?.status === "RUNNING" ? "扫描中…" : "立即检查网盘"}
            </button>
            <button
              className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400 disabled:opacity-50"
              disabled={pushAllMutation.isPending || pushing}
              onClick={() => {
                if (
                  window.confirm(
                    `将 ${status.totalPhotos - status.syncedCount} 张未同步照片推送到网盘镜像？`,
                  )
                ) {
                  pushAllMutation.mutate();
                }
              }}
              type="button"
            >
              <UploadCloud size={14} />
              全量推送
            </button>
            <button
              className="rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-500 hover:border-neutral-600"
              disabled={disconnectMutation.isPending}
              onClick={() => {
                if (window.confirm("断开后上传不再自动推送，确定？")) {
                  disconnectMutation.mutate();
                }
              }}
              type="button"
            >
              断开连接
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input
              checked={status.dailyScan}
              className="accent-white"
              onChange={(event) => onToggleDailyScan(event.target.checked)}
              type="checkbox"
            />
            每日凌晨自动扫描网盘增量
          </label>

          {report && report.status !== "RUNNING" && (
            <div className="rounded-lg border border-neutral-800 p-3 text-sm text-neutral-400">
              <p>
                上次扫描（{new Date(report.scannedAt).toLocaleString()}）：
                {report.status === "FAILED"
                  ? `失败 — ${report.error}`
                  : `导入 ${report.importedCount} 张，新建专辑 ${report.albumsCreated.length} 个，缺失 ${report.missing.length} 张`}
              </p>
              {report.albumsCreated.length > 0 && (
                <p className="mt-1 text-neutral-500">
                  新专辑：{report.albumsCreated.join("、")}
                </p>
              )}
              {report.missing.length > 0 && (
                <p className="mt-1 text-amber-400">
                  网盘侧缺失（已被手动删除，站内照片未动）：
                  {report.missing
                    .slice(0, 10)
                    .map((photo) => photo.filename)
                    .join("、")}
                  {report.missing.length > 10 && "…"}
                </p>
              )}
            </div>
          )}

          {status.pendingDeletes.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-900/50 p-3">
              <p className="text-sm text-amber-400">
                待确认删除（站内已删，网盘副本待处理）：
              </p>
              {status.pendingDeletes.map((item) => (
                <div
                  className="flex flex-wrap items-center gap-2 text-sm text-neutral-400"
                  key={item.id}
                >
                  <span className="flex-1 truncate">
                    {item.filename}（{item.albumTitle}）
                  </span>
                  <button
                    className="rounded-full border border-red-900 px-3 py-1 text-red-400 hover:border-red-500 disabled:opacity-50"
                    disabled={confirmDeleteMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除网盘文件 ${item.filename}？不可恢复。`,
                        )
                      ) {
                        confirmDeleteMutation.mutate(item.id);
                      }
                    }}
                    type="button"
                  >
                    删除网盘文件
                  </button>
                  <button
                    className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-400 hover:border-neutral-500 disabled:opacity-50"
                    disabled={dismissDeleteMutation.isPending}
                    onClick={() => dismissDeleteMutation.mutate(item.id)}
                    type="button"
                  >
                    保留
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BasicSection({
  settings,
  onSave,
}: {
  settings: SiteSetting;
  onSave: (input: Record<string, unknown>) => void;
}) {
  const [siteName, setSiteName] = useState(settings.siteName);
  const [siteDescription, setSiteDescription] = useState(
    settings.siteDescription,
  );
  const [about, setAbout] = useState(settings.about);
  const [contactEmail, setContactEmail] = useState(settings.contactEmail ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    onSave({
      siteName: siteName.trim(),
      siteDescription: siteDescription,
      about: about,
      contactEmail: contactEmail.trim(),
    });
  }

  return (
    <form
      className="space-y-4 rounded-2xl border border-neutral-800 p-5"
      onSubmit={handleSubmit}
    >
      <h2 className="text-sm font-medium text-neutral-300">基本信息</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldInput label="站点名" onChange={setSiteName} value={siteName} />
        <FieldInput
          label="联系邮箱"
          onChange={setContactEmail}
          placeholder="未填则前台不显示"
          type="email"
          value={contactEmail}
        />
      </div>
      <FieldInput
        label="站点简介"
        onChange={setSiteDescription}
        placeholder="一句话介绍（首页与分享卡片用）"
        value={siteDescription}
      />
      <label className="block space-y-1.5">
        <span className="text-sm text-neutral-400">关于页正文（空行分段）</span>
        <textarea
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          onChange={(event) => setAbout(event.target.value)}
          rows={6}
          value={about}
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <SaveButton />
    </form>
  );
}

function SocialLinksSection({
  initial,
  onSave,
}: {
  initial: SocialLinkDraft[];
  onSave: (links: SocialLinkDraft[]) => void;
}) {
  const [links, setLinks] = useState<SocialLinkRow[]>(() =>
    initial.map((link, i) => ({ ...link, key: `link-${i}` })),
  );

  function update(key: string, patch: Partial<SocialLinkDraft>) {
    setLinks((current) =>
      current.map((link) => (link.key === key ? { ...link, ...patch } : link)),
    );
  }

  return (
    <form
      className="space-y-4 rounded-2xl border border-neutral-800 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const cleaned = links.filter(
          (link) => link.label.trim() && link.url.trim(),
        );
        onSave(
          cleaned.map((link) => ({
            label: link.label.trim(),
            url: link.url.trim(),
          })),
        );
      }}
    >
      <h2 className="text-sm font-medium text-neutral-300">社交链接</h2>
      {links.length === 0 && (
        <p className="text-sm text-neutral-500">还没有添加。</p>
      )}
      {links.map((link) => (
        <div className="flex gap-2" key={link.key}>
          <input
            className="w-32 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            onChange={(event) =>
              update(link.key, { label: event.target.value })
            }
            placeholder="名称"
            value={link.label}
          />
          <input
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            onChange={(event) => update(link.key, { url: event.target.value })}
            placeholder="https://…"
            value={link.url}
          />
          <button
            aria-label="删除此链接"
            className="rounded-lg border border-neutral-700 p-2 text-neutral-400 hover:border-neutral-400"
            onClick={() =>
              setLinks((current) =>
                current.filter((item) => item.key !== link.key),
              )
            }
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400"
          onClick={() =>
            setLinks((current) => [
              ...current,
              { label: "", url: "", key: `link-${Date.now()}` },
            ])
          }
          type="button"
        >
          <Plus size={15} />
          添加一条
        </button>
        <SaveButton />
      </div>
    </form>
  );
}

function QrSection({
  qrUrl,
  onUpload,
  uploading,
}: {
  qrUrl: string | null;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-neutral-800 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-300">
        <QrCode size={15} />
        微信二维码
      </h2>
      <div className="flex items-center gap-4">
        {qrUrl ? (
          // biome-ignore lint/performance/noImgElement: 二维码走本地 /media，不走 next/image 优化
          <img
            alt="微信二维码"
            className="w-32 rounded-lg border border-neutral-800"
            src={qrUrl}
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-neutral-900 text-xs text-neutral-600">
            未上传
          </div>
        )}
        <label className="cursor-pointer rounded-full border border-dashed border-neutral-600 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400">
          {uploading ? "上传中…" : "上传二维码"}
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(file);
            }}
            type="file"
          />
        </label>
      </div>
    </section>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-neutral-400">{label}</span>
      <input
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function SaveButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <button
      className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
      disabled={disabled}
      type="submit"
    >
      保存
    </button>
  );
}
