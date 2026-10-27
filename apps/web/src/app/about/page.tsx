import { connection } from "next/server";
import { Suspense } from "react";
import { loadSettings } from "@/lib/settings";

export const metadata = {
  title: "关于",
  description: "关于江流儿摄影",
};

export default function AboutPage() {
  return (
    <main className="mx-auto min-h-[70vh] max-w-2xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-medium tracking-tight">关于</h1>
      <Suspense fallback={<p className="text-neutral-500">加载中…</p>}>
        <AboutContent />
      </Suspense>
    </main>
  );
}

async function AboutContent() {
  await connection();
  const settings = await loadSettings();

  const paragraphs = settings.about
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return <p className="text-neutral-500">还没有填写个人介绍。</p>;
  }

  return (
    <div className="space-y-4">
      {paragraphs.map((text) => (
        <p className="leading-7 text-neutral-400" key={text.slice(0, 24)}>
          {text}
        </p>
      ))}
      {settings.siteDescription && (
        <p className="text-sm text-neutral-500">{settings.siteDescription}</p>
      )}
    </div>
  );
}
