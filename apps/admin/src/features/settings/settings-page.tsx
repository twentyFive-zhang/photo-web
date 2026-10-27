import type { SiteSetting } from "@photo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFetch, mediaUrl } from "../../lib/api.js";
import { AdminShell } from "../../lib/shell.js";

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
      setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => setError(err.message),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
    onError: (err) => setError(err.message),
  });

  if (settingsQuery.isPending) {
    return <p className="p-8 text-neutral-400">加载中…</p>;
  }
  const settings = settingsQuery.data;
  if (!settings) return null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 p-8">
      <h1 className="text-2xl font-medium">站点设置</h1>
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

      {saved && <p className="text-sm text-green-400">已保存</p>}
    </main>
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
            className="rounded-lg border border-neutral-700 px-3 text-sm text-neutral-400 hover:border-neutral-400"
            onClick={() =>
              setLinks((current) =>
                current.filter((item) => item.key !== link.key),
              )
            }
            type="button"
          >
            删除
          </button>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          className="rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400"
          onClick={() =>
            setLinks((current) => [
              ...current,
              { label: "", url: "", key: `link-${Date.now()}` },
            ])
          }
          type="button"
        >
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
      <h2 className="text-sm font-medium text-neutral-300">微信二维码</h2>
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
