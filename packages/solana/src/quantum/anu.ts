/**
 * ANU Quantum Numbers provider (api.quantumnumbers.anu.edu.au, AWS-hosted
 * successor of qrng.anu.edu.au).
 *
 * Verified against the public examples (ANU gist + docs):
 *   GET https://api.quantumnumbers.anu.edu.au/?length=N&type=uint8
 *   header  x-api-key: <ANU_QRNG_API_KEY>
 *   length  1–1024; type uint8 | uint16 | hex8 | hex16; size 1–10 (hex only)
 *   200 → { success: true, type, length, data: [...] }
 *   error → { success: false, message }
 * We request `uint8` so every element is an unambiguous byte 0–255.
 */

import { NotImplemented } from "@quantagent/core/types";
import { envOf, fetchOf, type Env, type FetchLike } from "../env";
import { QrngUnreachable, type EntropyResult, type QrngProvider } from "./provider";

export const ANU_API_KEY_ENV = "ANU_QRNG_API_KEY";
export const ANU_API_URL = "https://api.quantumnumbers.anu.edu.au/";
export const ANU_MAX_LENGTH = 1024;

export interface AnuProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class AnuQrngProvider implements QrngProvider {
  readonly name = "anu";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: AnuProviderOptions) {
    if (!opts.apiKey) throw new Error("AnuQrngProvider needs an apiKey");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? ANU_API_URL;
    this.fetch = fetchOf(opts.fetch);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async fetchEntropy(input: { bytes: number; context: string }): Promise<EntropyResult> {
    const n = input.bytes;
    if (!Number.isInteger(n) || n < 1 || n > ANU_MAX_LENGTH) {
      throw new Error(`ANU length must be 1–${ANU_MAX_LENGTH}, got ${n}`);
    }
    const url = new URL(this.baseUrl);
    url.searchParams.set("length", String(n));
    url.searchParams.set("type", "uint8");
    const requestUrl = url.toString();
    const requestedAt = new Date().toISOString();

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    let text: string;
    try {
      res = await this.fetch(requestUrl, {
        method: "GET",
        headers: { "x-api-key": this.apiKey, accept: "application/json" },
        signal: ctl.signal,
      });
      text = await res.text();
    } catch (err) {
      throw new QrngUnreachable(this.name, err instanceof Error ? err.message : String(err), { cause: err });
    } finally {
      clearTimeout(timer);
    }
    const receivedAt = new Date().toISOString();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new QrngUnreachable(this.name, `non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const msg = (json as { message?: string })?.message ?? text.slice(0, 200);
      throw new QrngUnreachable(this.name, `HTTP ${res.status}: ${msg}`);
    }
    const body = json as { success?: boolean; data?: unknown; message?: string; type?: string };
    if (body.success !== true || !Array.isArray(body.data)) {
      throw new QrngUnreachable(this.name, `unsuccessful response: ${body.message ?? JSON.stringify(json).slice(0, 200)}`);
    }
    if (body.data.length !== n) {
      throw new QrngUnreachable(this.name, `asked for ${n} bytes, got ${body.data.length}`);
    }
    const entropy = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = body.data[i];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) {
        throw new QrngUnreachable(this.name, `element ${i} is not a uint8: ${JSON.stringify(v)}`);
      }
      entropy[i] = v;
    }
    return { entropy, requestUrl, requestedAt, receivedAt, rawResponse: json };
  }
}

/** Build the ANU provider from the environment, or throw NotImplemented naming the key. */
export function anuProviderFromEnv(env?: Env, fetch?: FetchLike): AnuQrngProvider {
  const e = envOf(env);
  const key = e[ANU_API_KEY_ENV];
  if (!key || key.trim() === "") {
    throw new NotImplemented("quantum draw", `${ANU_API_KEY_ENV} not set`, [ANU_API_KEY_ENV]);
  }
  const opts: AnuProviderOptions = { apiKey: key.trim() };
  if (fetch) opts.fetch = fetch;
  if (e.ANU_QRNG_API_URL) opts.baseUrl = e.ANU_QRNG_API_URL;
  return new AnuQrngProvider(opts);
}
