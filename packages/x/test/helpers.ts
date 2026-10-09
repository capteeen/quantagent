/**
 * Test helpers: a deterministic clock, a recording fetch mock, and a client
 * factory. No network is ever touched by this test suite.
 */
import { MonthlyBudget, MemoryBudgetStore } from "../src/budget/budget";
import { StaticTokenProvider, type AccessTokenProvider } from "../src/client/auth";
import { XHttp, type XLogEvent } from "../src/client/http";
import { XApiClient, type XApiClientOptions } from "../src/client/xClient";
import type { FetchLike } from "../src/oauth/oauth";
import { MemoryDeadLetterQueue, type DeadLetterQueue } from "../src/ratelimit/dlq";
import { RateLimiter, type RateLimiterOptions } from "../src/ratelimit/limiter";

export class FakeClock {
  t: number;
  readonly sleeps: number[] = [];
  constructor(start = Date.UTC(2026, 9, 9, 12, 0, 0)) {
    this.t = start;
  }
  now = (): number => this.t;
  sleep = async (ms: number): Promise<void> => {
    this.sleeps.push(ms);
    this.t += ms;
  };
  advance(ms: number): void {
    this.t += ms;
  }
}

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  rawBody: unknown;
  /** Parsed JSON body when content-type is JSON, URLSearchParams for forms, FormData as-is. */
  body: unknown;
}

export type Reply = Response | { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };
export type MockHandler = (call: RecordedCall, index: number) => Reply | Promise<Reply>;

export function reply(spec: Exclude<Reply, Response>): Response {
  const headers = new Headers(spec.headers ?? {});
  let body: string | null = null;
  if (spec.json !== undefined) {
    body = JSON.stringify(spec.json);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (spec.text !== undefined) {
    body = spec.text;
  }
  return new Response(body, { status: spec.status ?? 200, headers });
}

export interface MockFetch extends FetchLike {
  calls: RecordedCall[];
  /** Replace the handler mid-test. */
  use(handler: MockHandler): void;
}

export function mockFetch(initial: MockHandler): MockFetch {
  let handler = initial;
  const calls: RecordedCall[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h) {
      if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) headers[k.toLowerCase()] = v;
      else for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
    }
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === "string") {
      const ct = headers["content-type"] ?? "";
      if (ct.includes("json")) body = JSON.parse(raw);
      else if (ct.includes("x-www-form-urlencoded")) body = new URLSearchParams(raw);
    }
    const call: RecordedCall = { url: new URL(input), method: (init?.method ?? "GET").toUpperCase(), headers, rawBody: raw, body };
    calls.push(call);
    const r = await handler(call, calls.length - 1);
    return r instanceof Response ? r : reply(r);
  }) as MockFetch;
  fn.calls = calls;
  fn.use = (h) => {
    handler = h;
  };
  return fn;
}

export interface BuiltClient {
  client: XApiClient;
  http: XHttp;
  dlq: DeadLetterQueue;
  budget: MonthlyBudget;
  limiter: RateLimiter;
  clock: FakeClock;
  fetch: MockFetch;
  assetFetch: MockFetch;
  events: XLogEvent[];
}

export interface BuildOptions {
  fetch: MockFetch;
  assetFetch?: MockFetch;
  clock?: FakeClock;
  auth?: AccessTokenProvider;
  budgetLimit?: number;
  limiter?: RateLimiterOptions;
  dlq?: DeadLetterQueue;
  maxAttempts?: number;
  client?: Partial<XApiClientOptions>;
}

export const ACCOUNT_ID = "1234567890";
export const HANDLE = "quantagent";

export function buildClient(opts: BuildOptions): BuiltClient {
  const clock = opts.clock ?? new FakeClock();
  const events: XLogEvent[] = [];
  const budget = new MonthlyBudget({ limit: opts.budgetLimit ?? 1500, store: new MemoryBudgetStore(), now: clock.now });
  const limiter = new RateLimiter({
    now: clock.now,
    sleep: clock.sleep,
    global: { capacity: 1000, refillPerSecond: 100 },
    perAccount: { capacity: 1000, refillPerSecond: 100 },
    ...(opts.limiter ?? {}),
  });
  const dlq = opts.dlq ?? new MemoryDeadLetterQueue(clock.now);
  const auth = opts.auth ?? new StaticTokenProvider(ACCOUNT_ID, "access-token", HANDLE);
  const http = new XHttp({
    auth,
    limiter,
    budget,
    fetch: opts.fetch,
    now: clock.now,
    sleep: clock.sleep,
    maxAttempts: opts.maxAttempts ?? 3,
    backoff: { baseMs: 1000, maxMs: 60_000, jitter: 0 },
    log: (e) => events.push(e),
  });
  const assetFetch = opts.assetFetch ?? mockFetch(() => ({ status: 404, text: "no asset mock" }));
  const client = new XApiClient({
    http,
    dlq,
    assetFetch,
    now: clock.now,
    log: (e) => events.push(e),
    media: { chunkBytes: 4, sleep: clock.sleep },
    ...(opts.client ?? {}),
  });
  return { client, http, dlq, budget, limiter, clock, fetch: opts.fetch, assetFetch, events };
}

/** A handler that answers POST /2/tweets with incrementing ids and everything else with 200 {}. */
export function tweetsOk(startId = 100): MockHandler {
  let next = startId;
  return (call) => {
    if (call.method === "POST" && call.url.pathname === "/2/tweets") {
      const b = call.body as { text: string };
      return { json: { data: { id: String(next++), text: b.text } } };
    }
    return { json: {} };
  };
}

export const TEST_KEY = "0f".repeat(32);
