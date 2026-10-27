import { loadSettings } from "@/lib/settings";

export async function SiteFooter() {
  const settings = await loadSettings();
  const year = 2026; // 静态年份，避免预渲染不稳定值

  return (
    <footer className="mt-24 border-t border-neutral-800/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {settings.siteName}
        </p>
        {settings.socialLinks.length > 0 && (
          <div className="flex gap-4">
            {settings.socialLinks.map((link) => (
              <a
                className="transition-colors hover:text-neutral-300"
                href={link.url}
                key={link.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
