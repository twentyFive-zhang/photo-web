export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-2xl space-y-6">
        <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">
          Jiangliuer Photography
        </p>
        <h1 className="text-5xl font-medium tracking-tight text-neutral-100 sm:text-7xl">
          江流儿摄影
        </h1>
        <p className="max-w-md text-base leading-7 text-neutral-400">
          光与影的记录。作品集正在整理中，很快见。
        </p>
        <div className="h-px w-16 bg-neutral-800" />
        <p className="text-sm text-neutral-600">个人摄影作品</p>
      </section>
    </main>
  );
}
