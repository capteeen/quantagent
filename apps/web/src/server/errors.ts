/**
 * Error → UI text. A NotImplemented keeps its capability, reason and the exact
 * env var names; every other error keeps its real message. Nothing is reworded.
 */
import { NotImplemented } from "@quantagent/core/types";
import type { Health, Unavailable } from "./types";

export function describeError(err: unknown): Unavailable {
  if (err instanceof NotImplemented) {
    return { ok: false, name: err.name, message: err.message, capability: err.capability, because: err.because, needs: [...err.needs] };
  }
  if (err instanceof Error) {
    const maybe = err as Error & { needs?: unknown; capability?: unknown; because?: unknown };
    const needs = Array.isArray(maybe.needs) ? maybe.needs.filter((n): n is string => typeof n === "string") : [];
    const out: Unavailable = { ok: false, name: err.name || "Error", message: err.message, needs };
    if (typeof maybe.capability === "string") out.capability = maybe.capability;
    if (typeof maybe.because === "string") out.because = maybe.because;
    return out;
  }
  return { ok: false, name: "Error", message: String(err), needs: [] };
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: Unavailable };

export async function attempt<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export function attemptSync<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export function healthOf<T>(r: Result<T>, detail?: (v: T) => string | undefined, notes?: string[]): Health {
  if (!r.ok) return r.error;
  const h: Health = { ok: true };
  const d = detail?.(r.value);
  if (d) h.detail = d;
  if (notes && notes.length) h.notes = notes;
  return h;
}

export class NotFound extends Error {
  override readonly name = "NotFound";
}

export class BadRequest extends Error {
  override readonly name = "BadRequest";
}
