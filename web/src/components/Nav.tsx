"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Map" },
  { href: "/dashboard/", label: "Dashboard" },
  { href: "/events/", label: "Events" },
  { href: "/compare/", label: "Compare" },
  { href: "/model/", label: "Model" },
  { href: "/method/", label: "Method" },
];

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3987e5" />
          <stop offset="0.5" stopColor="#9085e9" />
          <stop offset="1" stopColor="#d95926" />
        </linearGradient>
      </defs>
      <path d="M12 2.5c3.6 4.6 6.5 8.2 6.5 11.6A6.5 6.5 0 0 1 5.5 14.1C5.5 10.7 8.4 7.1 12 2.5Z" fill="url(#sheen)" />
      <path d="M8.2 15.2c.8 1.6 2.2 2.4 3.8 2.4" stroke="#0d0d0d" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur">
      <div className="flex h-12 items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          <span>BlackTide</span>
          <span className="hidden text-xs font-normal text-muted sm:inline">Niger Delta</span>
        </Link>
        <nav className="hidden gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                active(l.href) ? "bg-white/10 text-ink" : "text-ink-2 hover:bg-white/5 hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <a
          href="https://github.com/TK87tech/blacktide"
          className="ml-auto hidden text-sm text-ink-2 hover:text-ink md:block"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
        <button
          className="ml-auto rounded-md px-2 py-1 text-ink-2 md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
        >
          ☰
        </button>
      </div>
      {open && (
        <nav className="flex flex-col border-t border-line px-2 py-2 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded px-3 py-2 text-sm text-ink-2">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
