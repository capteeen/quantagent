import { randomBytes } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { Rpc } from "../src/cluster";
import type { Env, FetchLike } from "../src/env";

export const WALLET_KEY_HEX = randomBytes(32).toString("hex");

export function baseEnv(extra: Env = {}): Env {
  return { AGENT_WALLET_KEY: WALLET_KEY_HEX, NODE_ENV: "test", ...extra };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function bytesResponse(bytes: Uint8Array, status = 200): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer as ArrayBuffer, { status, headers: { "content-type": "application/octet-stream" } });
}

export interface RecordedCall {
  url: string;
  init?: RequestInit;
  json?: unknown;
}

/** fetch mock that records calls and routes by URL substring. */
export function mockFetch(routes: Record<string, (call: RecordedCall) => Response | Promise<Response>>): FetchLike & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const call: RecordedCall = { url, ...(init ? { init } : {}) };
    if (init?.body && typeof init.body === "string") {
      try {
        call.json = JSON.parse(init.body);
      } catch {
        /* not json */
      }
    }
    calls.push(call);
    for (const [k, handler] of Object.entries(routes)) {
      if (url.includes(k)) return handler(call);
    }
    return new Response(`no route for ${url}`, { status: 599 });
  }) as FetchLike & { calls: RecordedCall[] };
  f.calls = calls;
  return f;
}

export const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

/** An unsigned v0 transaction whose required signers are `payer` plus `extraSigners`. */
export function unsignedTx(payer: PublicKey, extraSigners: PublicKey[] = []): VersionedTransaction {
  const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  for (const s of extraSigners) {
    instructions.push(
      SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: s, lamports: 1, space: 0, programId: SystemProgram.programId }),
    );
  }
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message();
  return new VersionedTransaction(msg);
}

export interface MockRpcOptions {
  balances?: number[];
  sendError?: Error;
  confirmErr?: unknown;
}

export function mockRpc(opts: MockRpcOptions = {}): Rpc & { sent: Uint8Array[]; balanceCalls: number } {
  const balances = [...(opts.balances ?? [])];
  const state = { sent: [] as Uint8Array[], balanceCalls: 0 };
  const rpc = {
    rpcEndpoint: "mock://rpc",
    async getLatestBlockhash() {
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 };
    },
    async sendRawTransaction(raw: Buffer | Uint8Array | number[]) {
      if (opts.sendError) throw opts.sendError;
      state.sent.push(Uint8Array.from(raw as Uint8Array));
      return `sig${state.sent.length}`;
    },
    async confirmTransaction() {
      return { context: { slot: 1 }, value: { err: opts.confirmErr ?? null } };
    },
    async getBalance() {
      state.balanceCalls++;
      if (balances.length > 1) return balances.shift()!;
      return balances[0] ?? 0;
    },
    async getSignaturesForAddress() {
      return [];
    },
    async getParsedTransactions() {
      return [];
    },
    async getProgramAccounts() {
      return [];
    },
  } as unknown as Rpc;
  return Object.assign(rpc, state);
}
