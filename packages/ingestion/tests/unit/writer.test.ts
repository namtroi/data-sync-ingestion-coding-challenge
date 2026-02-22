import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DBWriter } from '../../src/db/writer';
import { TransformedRow } from '../../src/ingestion/transformer.js';
import { Pool, PoolClient } from 'pg';

describe('DBWriter', () => {
  let mockClient: any;
  let mockPool: any;
  let writer: DBWriter;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    };
    writer = new DBWriter(mockPool as unknown as Pool, 5000);
  });

  const generateRows = (count: number): TransformedRow[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      event_type: 'click',
      timestamp: new Date(),
      data: { foo: 'bar' }
    }));
  };

  it('add(rows) — buffers rows in memory', async () => {
    const rows = generateRows(100);
    await writer.add(rows);
    expect(writer.getBufferLength()).toBe(100);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('add(rows) — auto-flushes when buffer reaches batch size', async () => {
    const rows = generateRows(100);
    await writer.add(rows); // 100
    
    const moreRows = generateRows(4900);
    await writer.add(moreRows); // total 5000 -> auto flush
    
    expect(writer.getBufferLength()).toBe(0);
    expect(mockClient.query).toHaveBeenCalledTimes(5); // BEGIN, INSERT STAGING, UPSERT, TRUNCATE, COMMIT
  });

  it('flush() — COPY rows into staging_events table (uses UNNEST/batch insert)', async () => {
    const rows = generateRows(10);
    await writer.add(rows);
    await writer.flush();
    
    // Expect the staging insert query to have been called
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    const calls = mockClient.query.mock.calls;
    const stagingQuery = calls.find((c: any) => c[0].includes('staging_events'));
    expect(stagingQuery).toBeDefined();
    expect(stagingQuery[0]).toContain('INSERT INTO staging_events');
  });

  it('flush() — INSERT from staging_events into ingested_events ON CONFLICT DO NOTHING', async () => {
    const rows = generateRows(10);
    await writer.add(rows);
    await writer.flush();
    
    const calls = mockClient.query.mock.calls;
    const upsertQuery = calls.find((c: any) => c[0].includes('ingested_events'));
    expect(upsertQuery).toBeDefined();
    expect(upsertQuery[0]).toContain('ON CONFLICT (id) DO NOTHING');
  });

  it('flush() — TRUNCATE staging_events after upsert', async () => {
    const rows = generateRows(10);
    await writer.add(rows);
    await writer.flush();
    
    const calls = mockClient.query.mock.calls;
    const truncateQuery = calls.find((c: any) => c[0].includes('TRUNCATE staging_events'));
    expect(truncateQuery).toBeDefined();
  });

  it('flush() — empty buffer -> no-op', async () => {
    await writer.flush();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('close() — flushes remaining + releases connection', async () => {
    const rows = generateRows(5);
    await writer.add(rows);
    await writer.close();
    
    expect(mockClient.query).toHaveBeenCalled(); // flushed
    expect(mockClient.release).toHaveBeenCalled(); // released main connection if held
  });
});
