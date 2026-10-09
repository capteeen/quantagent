/**
 * Small shared building blocks for the kit. Not exported from the package index.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { WORKER_COLORS, type WorkerName } from "@quantagent/core/types";
import { colors } from "../tokens";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** `AbCd…WxYz` for keys, CAs and signatures. */
export function shortKey(key: string, head = 4, tail = 4): string {
  if (key.length <= head + tail + 1) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

/** `HH:MM:SS` in the viewer's zone; the ISO string stays in a `title` for the full value. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Readable ink on a worker colour chip. */
export function inkOn(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return colors.void;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? colors.void : colors.tunnel;
}

export function workerColor(name: WorkerName): string {
  return WORKER_COLORS[name];
}

export const explorerTxUrl = (sig: string, cluster: "devnet" | "mainnet-beta" = "mainnet-beta"): string =>
  `https://solscan.io/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

export const explorerAccountUrl = (
  key: string,
  cluster: "devnet" | "mainnet-beta" = "mainnet-beta",
): string => `https://solscan.io/account/${key}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

export const pumpFunUrl = (ca: string): string => `https://pump.fun/coin/${ca}`;

export const xPostUrl = (postId: string): string => `https://x.com/i/web/status/${postId}`;

export function Panel({
  children,
  className,
  tone = "panel",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  tone?: "panel" | "void" | "failed";
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3 font-mono text-sm text-text",
        tone === "panel" && "border-border bg-panel",
        tone === "void" && "border-border bg-void",
        tone === "failed" && "border-worker-shield/60 bg-panel",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Heading({ children, className, as = "h3" }: { children: ReactNode; className?: string; as?: "h1" | "h2" | "h3" | "h4" }) {
  const Tag = as;
  return <Tag className={cx("font-heading font-heading text-base leading-tight text-tunnel", className)}>{children}</Tag>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("font-mono text-[11px] uppercase tracking-wider text-muted", className)}>{children}</div>;
}

export function Dot({ color, className, title }: { color: string; className?: string; title?: string }) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("inline-flex min-h-hit items-center text-probability underline decoration-dotted underline-offset-2", className)}
    >
      {children}
    </a>
  );
}

/** Copy with the Clipboard API; falls back to a hidden textarea; reports honestly. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand ? document.execCommand("copy") : false;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Button base: 44px hit area, mono, honest disabled look. */
export const buttonBase =
  "inline-flex min-h-hit min-w-hit select-none items-center justify-center rounded-lg border px-4 font-mono text-sm transition-colors duration-quant ease-quant disabled:cursor-not-allowed disabled:opacity-50";

export const buttonTone = {
  primary: "border-probability bg-probability text-void active:brightness-90",
  ghost: "border-border bg-panel text-text active:bg-border",
  danger: "border-worker-shield/60 bg-panel text-worker-shield active:bg-border",
  amber: "border-decay bg-panel text-decay active:bg-border",
} as const;

export function FailBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cx("rounded-lg border border-worker-shield/60 bg-void px-3 py-2 font-mono text-xs text-worker-shield", className)}>
      {children}
    </div>
  );
}
