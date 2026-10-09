/**
 * Environment access for @quantagent/solana. Every env var the package reads is
 * listed in README.md under "Environment". Functions take an optional `env`
 * so tests never touch process.env.
 */

export type Env = Record<string, string | undefined>;

export function envOf(env?: Env): Env {
  return env ?? (process.env as Env);
}

export function envFlag(env: Env, name: string): boolean {
  const v = env[name];
  return v === "true" || v === "1" || v === "yes";
}

export function envNumber(env: Env, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

export function envNumberList(env: Env, name: string, fallback: number[]): number[] {
  const v = env[name];
  if (v === undefined || v.trim() === "") return [...fallback];
  const out = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} contains a non-positive number: "${s}"`);
      return n;
    });
  return out.sort((a, b) => a - b);
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production";
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function fetchOf(f?: FetchLike): FetchLike {
  if (f) return f;
  if (typeof globalThis.fetch !== "function") {
    throw new Error("global fetch is not available; pass a fetch implementation");
  }
  return (input, init) => globalThis.fetch(input, init);
}
