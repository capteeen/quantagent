/**
 * Token storage. Every store encrypts the token payload with a TokenCipher
 * before it touches storage, including the in-memory store, so a dump of
 * either never contains a plaintext access or refresh token.
 */
import { NotImplemented } from "@quantagent/core/types";
import type { TokenCipher } from "./crypto";
import { createTokenCipher } from "./crypto";

export interface StoredTokens {
  /** X user id (numeric string) the tokens belong to. */
  accountId: string;
  /** @handle without the "@", when known. */
  handle?: string;
  accessToken: string;
  /** Present when the offline.access scope was granted. */
  refreshToken?: string;
  /** ISO timestamp when accessToken expires. */
  expiresAt: string;
  scopes: string[];
  updatedAt: string;
}

export interface TokenListing {
  accountId: string;
  handle?: string;
  expiresAt: string;
  updatedAt: string;
}

export interface TokenStore {
  get(accountId: string): Promise<StoredTokens | null>;
  put(tokens: StoredTokens): Promise<void>;
  delete(accountId: string): Promise<void>;
  /** Metadata only; never returns token material. */
  list(): Promise<TokenListing[]>;
}

/* ─────────────────────────── in-memory ─────────────────────────── */

interface MemoryRow {
  accountId: string;
  handle?: string;
  expiresAt: string;
  updatedAt: string;
  ciphertext: string;
}

export class MemoryTokenStore implements TokenStore {
  private readonly rows = new Map<string, MemoryRow>();
  constructor(private readonly cipher: TokenCipher) {}

  async get(accountId: string): Promise<StoredTokens | null> {
    const row = this.rows.get(accountId);
    if (!row) return null;
    return JSON.parse(this.cipher.decrypt(row.ciphertext)) as StoredTokens;
  }
  async put(tokens: StoredTokens): Promise<void> {
    const row: MemoryRow = {
      accountId: tokens.accountId,
      expiresAt: tokens.expiresAt,
      updatedAt: tokens.updatedAt,
      ciphertext: this.cipher.encrypt(JSON.stringify(tokens)),
    };
    if (tokens.handle !== undefined) row.handle = tokens.handle;
    this.rows.set(tokens.accountId, row);
  }
  async delete(accountId: string): Promise<void> {
    this.rows.delete(accountId);
  }
  async list(): Promise<TokenListing[]> {
    return [...this.rows.values()].map((r) => {
      const out: TokenListing = { accountId: r.accountId, expiresAt: r.expiresAt, updatedAt: r.updatedAt };
      if (r.handle !== undefined) out.handle = r.handle;
      return out;
    });
  }
  /** Test hook: what is actually held in memory (ciphertext only). */
  rawRows(): ReadonlyArray<Readonly<MemoryRow>> {
    return [...this.rows.values()];
  }
}

/* ─────────────────────────── postgres ─────────────────────────── */

/** Minimal slice of pg.Pool / pg.Client so tests can inject a fake. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const X_TOKENS_DDL = `
CREATE TABLE IF NOT EXISTS x_tokens (
  account_id  text PRIMARY KEY,
  handle      text,
  ciphertext  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
)`;

export class PostgresTokenStore implements TokenStore {
  private ready: Promise<void> | null = null;
  constructor(
    private readonly db: Queryable,
    private readonly cipher: TokenCipher,
  ) {}

  /** Creates the x_tokens table if missing. Called lazily on first use. */
  async migrate(): Promise<void> {
    if (!this.ready) this.ready = this.db.query(X_TOKENS_DDL).then(() => undefined);
    await this.ready;
  }

  async get(accountId: string): Promise<StoredTokens | null> {
    await this.migrate();
    const { rows } = await this.db.query("SELECT ciphertext FROM x_tokens WHERE account_id = $1", [accountId]);
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(this.cipher.decrypt(String(row["ciphertext"]))) as StoredTokens;
  }

  async put(tokens: StoredTokens): Promise<void> {
    await this.migrate();
    await this.db.query(
      `INSERT INTO x_tokens (account_id, handle, ciphertext, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE SET
         handle = EXCLUDED.handle,
         ciphertext = EXCLUDED.ciphertext,
         expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at`,
      [
        tokens.accountId,
        tokens.handle ?? null,
        this.cipher.encrypt(JSON.stringify(tokens)),
        tokens.expiresAt,
        tokens.updatedAt,
      ],
    );
  }

  async delete(accountId: string): Promise<void> {
    await this.migrate();
    await this.db.query("DELETE FROM x_tokens WHERE account_id = $1", [accountId]);
  }

  async list(): Promise<TokenListing[]> {
    await this.migrate();
    const { rows } = await this.db.query(
      "SELECT account_id, handle, expires_at, updated_at FROM x_tokens ORDER BY updated_at DESC",
    );
    return rows.map((r) => {
      const out: TokenListing = {
        accountId: String(r["account_id"]),
        expiresAt: toIso(r["expires_at"]),
        updatedAt: toIso(r["updated_at"]),
      };
      if (r["handle"] != null) out.handle = String(r["handle"]);
      return out;
    });
  }
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/* ─────────────────────────── from env ─────────────────────────── */

/**
 * Picks a store from the environment:
 *   DATABASE_URL set            → PostgresTokenStore (table x_tokens)
 *   X_TOKEN_STORE=memory        → MemoryTokenStore (dev/tests only; tokens vanish on restart)
 *   neither                     → NotImplemented
 * X_TOKEN_KEY is always required.
 */
export async function createTokenStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<TokenStore> {
  const cipher = createTokenCipher(env["X_TOKEN_KEY"]);
  if (env["DATABASE_URL"]) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: env["DATABASE_URL"] });
    return new PostgresTokenStore(pool, cipher);
  }
  if (env["X_TOKEN_STORE"] === "memory") {
    return new MemoryTokenStore(cipher);
  }
  throw new NotImplemented(
    "x.tokenStore",
    "connected-account tokens need durable storage; set DATABASE_URL (Postgres, table x_tokens) or opt into X_TOKEN_STORE=memory for local development",
    ["DATABASE_URL", "X_TOKEN_STORE"],
  );
}
