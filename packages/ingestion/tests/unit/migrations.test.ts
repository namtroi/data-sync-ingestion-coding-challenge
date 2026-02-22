import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMigrations } from '../../src/db/migrations';
import { Pool } from 'pg';

describe('runMigrations', () => {
  let mockQuery: any;
  let mockPool: any;

  beforeEach(() => {
    mockQuery = vi.fn().mockResolvedValue(undefined);
    mockPool = {
      query: mockQuery
    };
  });

  it('runMigrations() — creates ingested_events, staging_events, cursor_state', async () => {
    await runMigrations(mockPool as unknown as Pool);
    
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const queryStr = mockQuery.mock.calls[0][0];
    
    expect(queryStr).toContain('CREATE TABLE IF NOT EXISTS ingested_events');
    expect(queryStr).toContain('CREATE UNLOGGED TABLE IF NOT EXISTS staging_events');
    expect(queryStr).toContain('CREATE TABLE IF NOT EXISTS cursor_state');
  });

  it('Idempotent — running twice doesn\'t error', async () => {
    // Calling it twice just calls the same IF NOT EXISTS query twice
    await runMigrations(mockPool as unknown as Pool);
    await runMigrations(mockPool as unknown as Pool);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
