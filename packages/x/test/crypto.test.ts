import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { createTokenCipher, parseTokenKey } from "../src/oauth/crypto";
import { MemoryTokenStore, PostgresTokenStore, createTokenStoreFromEnv, type Queryable, type StoredTokens } from "../src/oauth/tokenStore";
import { TEST_KEY } from "./helpers";

const tokens: StoredTokens = {
  accountId: "42",
  handle: "projectx",
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  expiresAt: "2026-10-09T14:00:00.000Z",
  scopes: ["tweet.read"],
  updatedAt: "2026-10-09T12:00:00.000Z",
};

describe("AES-256-GCM token cipher", () => {
  it("round-trips and never emits the plaintext", () => {
    const c = createTokenCipher(TEST_KEY);
    const ct = c.encrypt("hello tokens");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("hello");
    expect(c.decrypt(ct)).toBe("hello tokens");
  });

  it("uses a fresh IV per encryption", () => {
    const c = createTokenCipher(TEST_KEY);
    expect(c.encrypt("same")).not.toBe(c.encrypt("same"));
  });

  it("detects tampering via the auth tag", () => {
    const c = createTokenCipher(TEST_KEY);
    const ct = c.encrypt("payload");
    const parts = ct.split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0] = body[0]! ^ 0xff;
    parts[3] = body.toString("base64url");
    expect(() => c.decrypt(parts.join("."))).toThrow();
  });

  it("refuses to decrypt with another key", () => {
    const ct = createTokenCipher(TEST_KEY).encrypt("payload");
    expect(() => createTokenCipher("ab".repeat(32)).decrypt(ct)).toThrow();
  });

  it("missing or malformed X_TOKEN_KEY is NotImplemented naming the variable", () => {
    for (const bad of [undefined, "", "abc", "zz".repeat(32)]) {
      try {
        parseTokenKey(bad);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(NotImplemented);
        expect((e as NotImplemented).needs).toEqual(["X_TOKEN_KEY"]);
      }
    }
  });
});

describe("MemoryTokenStore", () => {
  it("holds only ciphertext and round-trips through get", async () => {
    const store = new MemoryTokenStore(createTokenCipher(TEST_KEY));
    await store.put(tokens);
    const raw = JSON.stringify(store.rawRows());
    expect(raw).not.toContain("access-secret");
    expect(raw).not.toContain("refresh-secret");
    expect(await store.get("42")).toEqual(tokens);
    expect(await store.list()).toEqual([{ accountId: "42", handle: "projectx", expiresAt: tokens.expiresAt, updatedAt: tokens.updatedAt }]);
    await store.delete("42");
    expect(await store.get("42")).toBeNull();
  });
});

describe("PostgresTokenStore", () => {
  function fakeDb() {
    const rows = new Map<string, Record<string, unknown>>();
    const queries: { text: string; params?: unknown[] | undefined }[] = [];
    const db: Queryable = {
      async query(text, params) {
        queries.push({ text, params });
        if (text.includes("CREATE TABLE")) return { rows: [] };
        if (text.startsWith("INSERT")) {
          const [account_id, handle, ciphertext, expires_at, updated_at] = params as unknown[];
          rows.set(String(account_id), { account_id, handle, ciphertext, expires_at: new Date(String(expires_at)), updated_at: new Date(String(updated_at)) });
          return { rows: [] };
        }
        if (text.startsWith("SELECT ciphertext")) {
          const r = rows.get(String(params?.[0]));
          return { rows: r ? [r] : [] };
        }
        if (text.startsWith("SELECT account_id")) return { rows: [...rows.values()] };
        if (text.startsWith("DELETE")) {
          rows.delete(String(params?.[0]));
          return { rows: [] };
        }
        throw new Error("unexpected query " + text);
      },
    };
    return { db, rows, queries };
  }

  it("migrates once, stores ciphertext in x_tokens, round-trips", async () => {
    const { db, rows, queries } = fakeDb();
    const store = new PostgresTokenStore(db, createTokenCipher(TEST_KEY));
    await store.put(tokens);
    await store.put(tokens);
    expect(queries.filter((q) => q.text.includes("CREATE TABLE IF NOT EXISTS x_tokens")).length).toBe(1);
    const stored = rows.get("42")!;
    expect(String(stored["ciphertext"])).not.toContain("access-secret");
    expect(await store.get("42")).toEqual(tokens);
    const listing = await store.list();
    expect(listing[0]).toMatchObject({ accountId: "42", handle: "projectx", expiresAt: tokens.expiresAt });
    await store.delete("42");
    expect(await store.get("42")).toBeNull();
  });
});

describe("createTokenStoreFromEnv", () => {
  it("needs X_TOKEN_KEY first", async () => {
    await expect(createTokenStoreFromEnv({})).rejects.toBeInstanceOf(NotImplemented);
  });
  it("needs DATABASE_URL or an explicit memory opt-in", async () => {
    await expect(createTokenStoreFromEnv({ X_TOKEN_KEY: TEST_KEY })).rejects.toMatchObject({
      name: "NotImplemented",
      needs: ["DATABASE_URL", "X_TOKEN_STORE"],
    });
    const s = await createTokenStoreFromEnv({ X_TOKEN_KEY: TEST_KEY, X_TOKEN_STORE: "memory" });
    expect(s).toBeInstanceOf(MemoryTokenStore);
  });
});
