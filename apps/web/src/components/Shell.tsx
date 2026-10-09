import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/ui";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "launch" },
  { href: "/me", label: "me" },
  { href: "/status", label: "status" },
  { href: "/how", label: "how" },
];

/** Phone-first page frame: 390px column, compact nav, the footer on every screen. */
export function Shell({ children, current }: { children: ReactNode; current?: string }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
      <header className="flex items-center justify-between px-4 pb-1 pt-3">
        <Link href="/" className="font-heading text-base text-tunnel">
          quantagent
        </Link>
        <nav aria-label="Screens" className="flex gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
              className={`inline-flex min-h-hit items-center rounded-full px-3 text-xs ${current === l.href ? "bg-panel text-tunnel" : "text-muted"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-6">{children}</main>
      <Footer />
    </div>
  );
}
