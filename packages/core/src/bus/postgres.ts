import pg from "pg";
import type { QuantagentEvent } from "../../types/index";
import type { EventStore } from "./store";

const { Pool } = pg;

export const LAUNCH_EVENTS_TABLE = "launch_events";

const DDL = `
CREATE TABLE IF NOT EXISTS ${LAUNCH_EVENTS_TABLE} (
  id         TEXT PRIMARY KEY,
  launch_id  TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  worker     TEXT,
  at         TIMESTAMPTZ NOT NULL,
  reason     TEXT NOT NULL,
  payload    JSONB NOT NULL,
  event      JSONB NOT NULL,
  UNIQUE (launch_id, seq)
);
CREATE INDEX IF NOT EXISTS ${LAUNCH_EVENTS_TABLE}_launch_seq ON ${LAUNCH_EVENTS_TABLE} (launch_id, seq);
`;

/**
 * Postgres-backed event store (table `launch_events`).
 * Constructed only when DATABASE_URL is set; see createStoreFromEnv().
 */
export class PostgresEventStore implements EventStore {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;
  private initialized = false;

  constructor(connectionString: string, poolOptions: Omit<pg.PoolConfig, "connectionString"> = {}) {
    if (!connectionString) throw new Error("PostgresEventStore requires a connection string");
    this.pool = new Pool({ connectionString, ...poolOptions });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(DDL);
    this.initialized = true;
  }

  async append(event: QuantagentEvent): Promise<void> {
    await this.init();
    const worker = "worker" in event ? event.worker : null;
    await this.pool.query(
      `INSERT INTO ${LAUNCH_EVENTS_TABLE} (id, launch_id, seq, type, worker, at, reason, payload, event)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.id,
        event.launchId,
        event.seq,
        event.type,
        worker,
        event.at,
        event.reason,
        JSON.stringify(event.payload),
        JSON.stringify(event),
      ],
    );
  }

  async list(launchId: string, afterSeq = 0): Promise<QuantagentEvent[]> {
    await this.init();
    const res = await this.pool.query<{ event: QuantagentEvent }>(
      `SELECT event FROM ${LAUNCH_EVENTS_TABLE} WHERE launch_id = $1 AND seq > $2 ORDER BY seq ASC`,
      [launchId, afterSeq],
    );
    return res.rows.map((r) => r.event);
  }

  async maxSeq(launchId: string): Promise<number> {
    await this.init();
    const res = await this.pool.query<{ max: number | null }>(
      `SELECT MAX(seq)::int AS max FROM ${LAUNCH_EVENTS_TABLE} WHERE launch_id = $1`,
      [launchId],
    );
    return res.rows[0]?.max ?? 0;
  }

  async launchIds(limit = 100): Promise<string[]> {
    await this.init();
    const res = await this.pool.query<{ launch_id: string }>(
      `SELECT launch_id, MAX(at) AS last FROM ${LAUNCH_EVENTS_TABLE} GROUP BY launch_id ORDER BY last DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => r.launch_id);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
