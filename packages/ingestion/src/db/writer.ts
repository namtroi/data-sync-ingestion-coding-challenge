import { Pool, PoolClient } from 'pg';
import { TransformedRow } from '../ingestion/transformer.js';

export class DBWriter {
  private buffer: TransformedRow[] = [];

  constructor(
    private pool: Pool,
    private batchSize: number = 5000
  ) {}

  public async add(rows: TransformedRow[]): Promise<void> {
    for (const row of rows) {
      this.buffer.push(row);
      if (this.buffer.length >= this.batchSize) {
        await this.flush();
      }
    }
  }

  public getBufferLength(): number {
    return this.buffer.length;
  }

  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = []; // clear buffer immediately to allow concurrent adds

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const ids = batch.map(r => r.id);
      const types = batch.map(r => r.event_type);
      const timestamps = batch.map(r => r.timestamp?.toISOString());
      const data = batch.map(r => r.data);

      // 1. Bulk insert into staging using UNNEST (faster than VALUES list)
      const stagingQuery = `
        INSERT INTO staging_events (id, event_type, timestamp, data)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::timestamptz[], $4::jsonb[])
      `;
      await client.query(stagingQuery, [ids, types, timestamps, data]);

      // 2. Upsert from staging -> main
      const upsertQuery = `
        INSERT INTO ingested_events (id, event_type, timestamp, data)
        SELECT id, event_type, timestamp, data FROM staging_events
        ON CONFLICT (id) DO NOTHING
      `;
      await client.query(upsertQuery);

      // 3. Truncate staging
      await client.query('TRUNCATE staging_events');

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.flush();
  }
}
