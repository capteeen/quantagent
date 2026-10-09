import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Reads prefers-reduced-motion safely (jsdom and SSR return false). */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches === true;
  } catch {
    return false;
  }
}

export function usePrefersReducedMotion(override?: boolean): boolean {
  const [v, setV] = useState<boolean>(() => override ?? prefersReducedMotion());
  useEffect(() => {
    if (override !== undefined) {
      setV(override);
      return;
    }
    let mq: MediaQueryList | null = null;
    try {
      mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
    } catch {
      mq = null;
    }
    if (!mq) return;
    const on = () => setV(mq!.matches);
    on();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", on);
      return () => mq!.removeEventListener("change", on);
    }
    return;
  }, [override]);
  return v;
}
