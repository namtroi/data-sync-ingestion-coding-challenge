import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrations';
import { DBWriter } from '../../src/db/writer';
import { saveCursor, loadCursor, CursorState } from '../../src/ingestion/cursor';

// Require local postgres for integration tests
// Run docker compose up -d postgres before testing
const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/ingestion';

describe('DB Integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    
    // Clean slate
    await pool.query('DROP TABLE IF EXISTS cursor_state, ingested_events, staging_events CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('Migrations create all tables in real Postgres', async () => {
    await runMigrations(pool);
    
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tables = res.rows.map(r => r.table_name);
    
    expect(tables).toContain('ingested_events');
    expect(tables).toContain('staging_events');
    expect(tables).toContain('cursor_state');
  });

  it('Writer inserts batch via COPY -> staging -> upsert flow', async () => {
    const writer = new DBWriter(pool, 5000);
    const rows = [
      { id: 'tst-1', event_type: 'click', timestamp: new Date(), data: { a: 1 } },
      { id: 'tst-2', event_type: 'view', timestamp: new Date(), data: { b: 2 } }
    ];
    
    await writer.add(rows);
    await writer.flush();
    
    const res = await pool.query('SELECT * FROM ingested_events WHERE id IN ($1, $2)', ['tst-1', 'tst-2']);
    expect(res.rowCount).toBe(2);
  });

  it('Duplicate insert -> no error, count unchanged', async () => {
    const row = { id: 'dup-1', event_type: 'click', timestamp: new Date(), data: { x: 1 } };
    
    const writer1 = new DBWriter(pool, 5000);
    await writer1.add([row]);
    await writer1.flush();
    
    // Try second time
    const writer2 = new DBWriter(pool, 5000);
    await writer2.add([row]);
    await expect(writer2.flush()).resolves.not.toThrow();
    
    // Still only 1 row
    const res = await pool.query('SELECT COUNT(*) as count FROM ingested_events WHERE id = $1', ['dup-1']);
    expect(parseInt(res.rows[0].count)).toBe(1);
  });

  it('Cursor save -> cursor load roundtrip', async () => {
    const state = CursorState.create();
    state.update('chk-pt-1', 5000);
    
    await saveCursor(pool, state);
    
    const loaded = await loadCursor(pool);
    expect(loaded).not.toBeNull();
    expect(loaded?.cursor).toBe('chk-pt-1');
    expect(loaded?.eventsIngested).toBe(5000);
  });

  it('COPY performance: 10k rows inserted < 1 second', async () => {
    const writer = new DBWriter(pool, 10000);
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      id: `perf-${i}`,
      event_type: 'bulk',
      timestamp: new Date(),
      data: { v: i }
    }));
    
    const start = performance.now();
    await writer.add(rows);
    await writer.flush();
    const end = performance.now();
    
    const durationMs = end - start;
    expect(durationMs).toBeLessThan(1000); // Should easily be < 1000ms
    
    // Cleanup perf rows to keep DB clean
    await pool.query("DELETE FROM ingested_events WHERE event_type = 'bulk'");
  });
});
