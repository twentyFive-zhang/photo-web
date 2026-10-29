import { zodResolver } from "@hookform/resolvers/zod";
import {
  type NetdiskScanTriggered,
  type NetdiskStatus,
  type SiteSetting,
  socialLinkSchema,
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
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, mediaUrl } from "@/lib/api";
import { AdminShell } from "@/lib/shell";

const basicSettingsSchema = z.object({
  siteName: z.string().min(1, "站点名不能为空").max(100),
  siteDescription: z.string().max(500),
  about: z.string().max(20000),
  contactEmail: z.union([z.email("邮箱格式不正确"), z.literal("")]),
});
type BasicSettingsValues = z.infer<typeof basicSettingsSchema>;

const socialLinksFormSchema = z.object({
  links: z.array(socialLinkSchema).max(20),
});
type SocialLinksFormValues = z.infer<typeof socialLinksFormSchema>;

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
      toast.success("站点设置已保存");
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
        key={`basic-${settings.updatedAt}`}
        settings={settings}
        onSave={(input) => updateMutation.mutate(input)}
        saving={updateMutation.isPending}
      />
      <SocialLinksSection
        key={`social-${settings.updatedAt}`}
        initial={settings.socialLinks}
        onSave={(socialLinks) => updateMutation.mutate({ socialLinks })}
        saving={updateMutation.isPending}
      />
      <QrSection
        qrUrl={settings.wechatQrKey ? mediaUrl(settings.wechatQrKey) : null}
        onUpload={qrMutation.mutate}
        uploading={qrMutation.isPending}
      />
      <NetdiskSection
        onToggleDailyScan={(netdiskDailyScan) =>
          updateMutation.mutate({ netdiskDailyScan })
        }
      />
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Cloud size={15} />
          百度网盘镜像同步
        </CardTitle>
      </CardHeader>
      <CardContent>
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
            <Button asChild>
              <a href="/api/admin/baidu/authorize">连接百度网盘</a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">
              已连接 · 已同步 {status.syncedCount} / {status.totalPhotos} 张
              {pushing && "（推送中…）"}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  scanMutation.isPending || report?.status === "RUNNING"
                }
                onClick={() => scanMutation.mutate()}
                type="button"
                variant="outline"
              >
                <RefreshCw size={14} />
                {report?.status === "RUNNING" ? "扫描中…" : "立即检查网盘"}
              </Button>
              <Button
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
                variant="outline"
              >
                <UploadCloud size={14} />
                全量推送
              </Button>
              <Button
                disabled={disconnectMutation.isPending}
                onClick={() => {
                  if (window.confirm("断开后上传不再自动推送，确定？")) {
                    disconnectMutation.mutate();
                  }
                }}
                type="button"
                variant="ghost"
              >
                断开连接
              </Button>
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
                    <Button
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
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      删除网盘文件
                    </Button>
                    <Button
                      disabled={dismissDeleteMutation.isPending}
                      onClick={() => dismissDeleteMutation.mutate(item.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      保留
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BasicSection({
  settings,
  onSave,
  saving,
}: {
  settings: SiteSetting;
  onSave: (input: BasicSettingsValues) => void;
  saving: boolean;
}) {
  const form = useForm<BasicSettingsValues>({
    resolver: zodResolver(basicSettingsSchema),
    defaultValues: {
      siteName: settings.siteName,
      siteDescription: settings.siteDescription,
      about: settings.about,
      contactEmail: settings.contactEmail ?? "",
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>基本信息</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => onSave(values))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="siteName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>站点名</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>联系邮箱</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="未填则前台不显示"
                        type="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="siteDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>站点简介</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="一句话介绍（首页与分享卡片用）"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="about"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>关于页正文（空行分段）</FormLabel>
                  <FormControl>
                    <Textarea rows={6} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button disabled={saving} type="submit">
              保存
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function SocialLinksSection({
  initial,
  onSave,
  saving,
}: {
  initial: { label: string; url: string }[];
  onSave: (links: { label: string; url: string }[]) => void;
  saving: boolean;
}) {
  const form = useForm<SocialLinksFormValues>({
    resolver: zodResolver(socialLinksFormSchema),
    defaultValues: { links: initial },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "links",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>社交链接</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => onSave(values.links))}
          >
            {fields.length === 0 && (
              <p className="text-sm text-neutral-500">还没有添加。</p>
            )}
            {fields.map((field, index) => (
              <div className="flex gap-2" key={field.id}>
                <FormField
                  control={form.control}
                  name={`links.${index}.label`}
                  render={({ field }) => (
                    <FormItem className="w-32">
                      <FormControl>
                        <Input placeholder="名称" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`links.${index}.url`}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input placeholder="https://…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  aria-label="删除此链接"
                  onClick={() => remove(index)}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <div className="flex gap-3">
              <Button
                onClick={() => append({ label: "", url: "" })}
                type="button"
                variant="outline"
              >
                <Plus size={15} />
                添加一条
              </Button>
              <Button disabled={saving} type="submit">
                保存
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <QrCode size={15} />
          微信二维码
        </CardTitle>
      </CardHeader>
      <CardContent>
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
          <Button asChild className="border-dashed" variant="outline">
            <label className="cursor-pointer">
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
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
