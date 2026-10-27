import { connection } from "next/server";
import { Suspense } from "react";
import { loadSettings } from "@/lib/settings";

export const metadata = {
  title: "联系",
  description: "联系江流儿",
};

export default function ContactPage() {
  return (
    <main className="mx-auto min-h-[70vh] max-w-2xl space-y-8 px-6 py-16">
      <h1 className="text-3xl font-medium tracking-tight">联系</h1>
      <Suspense fallback={<p className="text-neutral-500">加载中…</p>}>
        <ContactContent />
      </Suspense>
    </main>
  );
}

async function ContactContent() {
  await connection();
  const settings = await loadSettings();

  const hasAnything =
    settings.contactEmail ||
    settings.wechatQrUrl ||
    settings.socialLinks.length > 0;

  if (!hasAnything) {
    return <p className="text-neutral-500">还没有填写联系方式。</p>;
  }

  return (
    <div className="space-y-8">
      {settings.contactEmail ? (
        <section className="space-y-2">
          <h2 className="text-sm uppercase tracking-[0.25em] text-neutral-500">
            邮箱
          </h2>
          <a
            className="text-neutral-200 underline decoration-neutral-700 underline-offset-4 hover:decoration-neutral-400"
            href={`mailto:${settings.contactEmail}`}
          >
            {settings.contactEmail}
          </a>
        </section>
      ) : null}

      {settings.wechatQrUrl ? (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-[0.25em] text-neutral-500">
            微信
          </h2>
          {/* biome-ignore lint/performance/noImgElement: 二维码 URL 来自 API 存储（本地 /media），不走 next/image 优化 */}
          <img
            alt="微信二维码"
            className="w-48 rounded-xl border border-neutral-800"
            src={settings.wechatQrUrl}
          />
          <p className="text-sm text-neutral-500">扫码添加微信</p>
        </section>
      ) : null}

      {settings.socialLinks.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-[0.25em] text-neutral-500">
            其他平台
          </h2>
          <ul className="space-y-2">
            {settings.socialLinks.map((link) => (
              <li key={link.url}>
                <a
                  className="text-neutral-300 underline decoration-neutral-700 underline-offset-4 hover:decoration-neutral-400"
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
