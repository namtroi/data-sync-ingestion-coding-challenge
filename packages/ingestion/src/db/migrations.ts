import { Pool } from 'pg';

export async function runMigrations(pool: Pool): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS ingested_events (
        id          TEXT PRIMARY KEY,
        event_type  TEXT,
        timestamp   TIMESTAMPTZ,
        data        JSONB NOT NULL,
        ingested_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNLOGGED TABLE IF NOT EXISTS staging_events (
        id          TEXT,
        event_type  TEXT,
        timestamp   TIMESTAMPTZ,
        data        JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cursor_state (
        id              SERIAL PRIMARY KEY,
        cursor_value    TEXT NOT NULL,
        events_ingested BIGINT NOT NULL DEFAULT 0,
        updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await pool.query(query);
}
