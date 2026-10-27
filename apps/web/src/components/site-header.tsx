import Link from "next/link";
import { loadSettings } from "@/lib/settings";

const NAV_ITEMS = [
  { href: "/albums", label: "专辑" },
  { href: "/about", label: "关于" },
  { href: "/contact", label: "联系" },
];

export async function SiteHeader() {
  const settings = await loadSettings();

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          className="text-sm font-medium tracking-wide text-neutral-100"
          href="/"
        >
          {settings.siteName}
        </Link>
        <nav className="flex gap-6">
          {NAV_ITEMS.map((item) => (
            <Link
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
