/**
 * KeyStore: where encrypted agent wallets live. Postgres in production
 * (table agent_wallets), in-memory for tests.
 */

import type { Cluster } from "../cluster";

export interface AgentWalletRecord {
  launchId: string;
  publicKey: string;
  /** AES-256-GCM blob from ./crypto. */
  encryptedSecretKey: string;
  cluster: Cluster;
  budgetLamports: bigint;
  spentLamports: bigint;
  createdAt: string;
}

export interface KeyStore {
  get(launchId: string): Promise<AgentWalletRecord | null>;
  /** Insert; rejects if the launch already has a wallet. */
  put(record: AgentWalletRecord): Promise<void>;
  /**
   * Atomically add to spent, but only if the result stays within budget.
   * Returns the new spent total, or null if the add would exceed the budget
   * (in which case nothing changes). Negative deltas release a reservation.
   */
  addSpent(launchId: string, deltaLamports: bigint): Promise<{ ok: boolean; spentLamports: bigint; budgetLamports: bigint }>;
}

export class MemoryKeyStore implements KeyStore {
  private readonly rows = new Map<string, AgentWalletRecord>();

  async get(launchId: string): Promise<AgentWalletRecord | null> {
    const r = this.rows.get(launchId);
    return r ? { ...r } : null;
  }

  async put(record: AgentWalletRecord): Promise<void> {
    if (this.rows.has(record.launchId)) throw new Error(`wallet for launch ${record.launchId} already exists`);
    this.rows.set(record.launchId, { ...record });
  }

  async addSpent(launchId: string, deltaLamports: bigint) {
    const r = this.rows.get(launchId);
    if (!r) throw new Error(`no wallet for launch ${launchId}`);
    const next = r.spentLamports + deltaLamports;
    if (next > r.budgetLamports) return { ok: false, spentLamports: r.spentLamports, budgetLamports: r.budgetLamports };
    r.spentLamports = next < 0n ? 0n : next;
    return { ok: true, spentLamports: r.spentLamports, budgetLamports: r.budgetLamports };
  }
}

/** Minimal pg surface so callers can pass a Pool, a Client or a transaction. */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const AGENT_WALLETS_DDL = `
CREATE TABLE IF NOT EXISTS agent_wallets (
  launch_id            TEXT PRIMARY KEY,
  public_key           TEXT NOT NULL UNIQUE,
  encrypted_secret_key TEXT NOT NULL,
  cluster              TEXT NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  budget_lamports      BIGINT NOT NULL CHECK (budget_lamports >= 0),
  spent_lamports       BIGINT NOT NULL DEFAULT 0 CHECK (spent_lamports >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export class PgKeyStore implements KeyStore {
  constructor(private readonly db: PgQueryable) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(AGENT_WALLETS_DDL);
  }

  async get(launchId: string): Promise<AgentWalletRecord | null> {
    const { rows } = await this.db.query(
      `SELECT launch_id, public_key, encrypted_secret_key, cluster, budget_lamports, spent_lamports, created_at
         FROM agent_wallets WHERE launch_id = $1`,
      [launchId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      launchId: String(r.launch_id),
      publicKey: String(r.public_key),
      encryptedSecretKey: String(r.encrypted_secret_key),
      cluster: r.cluster as Cluster,
      budgetLamports: BigInt(String(r.budget_lamports)),
      spentLamports: BigInt(String(r.spent_lamports)),
      createdAt: new Date(String(r.created_at)).toISOString(),
    };
  }

  async put(record: AgentWalletRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_wallets (launch_id, public_key, encrypted_secret_key, cluster, budget_lamports, spent_lamports, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.launchId,
        record.publicKey,
        record.encryptedSecretKey,
        record.cluster,
        record.budgetLamports.toString(),
        record.spentLamports.toString(),
        record.createdAt,
      ],
    );
  }

  async addSpent(launchId: string, deltaLamports: bigint) {
    // Single statement, so the budget check and the increment are atomic.
    const { rows } = await this.db.query(
      `UPDATE agent_wallets
          SET spent_lamports = GREATEST(0, spent_lamports + $2::bigint)
        WHERE launch_id = $1 AND spent_lamports + $2::bigint <= budget_lamports
        RETURNING spent_lamports, budget_lamports`,
      [launchId, deltaLamports.toString()],
    );
    const r = rows[0];
    if (r) {
      return { ok: true, spentLamports: BigInt(String(r.spent_lamports)), budgetLamports: BigInt(String(r.budget_lamports)) };
    }
    const cur = await this.get(launchId);
    if (!cur) throw new Error(`no wallet for launch ${launchId}`);
    return { ok: false, spentLamports: cur.spentLamports, budgetLamports: cur.budgetLamports };
  }
}
