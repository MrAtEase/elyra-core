"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/product", label: "Product" },
  { href: "/solutions", label: "Solutions" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
];

export default function MarketingHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0f18]/78 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex items-center" aria-label="Elyra Core home">
          <Image
            src="/brand/elyra-logo.svg"
            alt="Elyra Core"
            width={140}
            height={32}
            priority
            className="h-6 w-auto opacity-95 sm:h-7 md:h-8"
          />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Marketing navigation">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`text-sm transition ${active ? "text-white" : "text-white/62 hover:text-white/88"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/signin"
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:border-white/20 hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/signin"
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[#0b0f18] transition hover:bg-white/90"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
