/**
 * Route-handler helpers. Every failure is returned as its real message with the
 * status that matches its class; NotImplemented is 501 and carries `needs`.
 */
import { NotImplemented } from "@quantagent/core/types";
import { BadRequest, NotFound, describeError } from "./errors";

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function statusFor(err: unknown): number {
  if (err instanceof NotImplemented) return 501;
  if (err instanceof NotFound) return 404;
  if (err instanceof BadRequest) return 400;
  if (err instanceof Error && err.name === "MainnetRefused") return 400;
  return 500;
}

export function errorResponse(err: unknown, status = statusFor(err), extraHeaders?: HeadersInit): Response {
  return json({ error: describeError(err) }, extraHeaders ? { status, headers: extraHeaders } : { status });
}

/** Parses a JSON body; an empty or malformed body is a BadRequest with the parser's message. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new BadRequest(`request body is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw new BadRequest(`"${key}" must be a non-empty string`);
  return v;
}
