/**
 * Dispose helpers: every geometry/material/texture built in the chamber goes through
 * useDisposable so it is released on unmount (SPEC §6.7: no heap growth across a launch).
 */
import { useEffect, useMemo, type DependencyList } from "react";

export interface Disposable {
  dispose(): void;
}

export function useDisposable<T extends Disposable | Disposable[]>(factory: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);
  useEffect(() => {
    return () => {
      if (Array.isArray(value)) for (const v of value) v.dispose();
      else value.dispose();
    };
  }, [value]);
  return value;
}

/** Deterministic PRNG (mulberry32) so recorded streams reproduce: never Math.random in the scene. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
