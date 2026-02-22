export interface CursorRow {
  id?: number;
  cursor_value: string;
  events_ingested: string | number;
  updated_at?: Date;
}

export class CursorState {
  private _cursor: string | null;
  private _eventsIngested: number;

  private constructor(cursor: string | null, eventsIngested: number) {
    this._cursor = cursor;
    this._eventsIngested = eventsIngested;
  }

  public get cursor(): string | null {
    return this._cursor;
  }

  public get eventsIngested(): number {
    return this._eventsIngested;
  }

  public static create(): CursorState {
    return new CursorState(null, 0);
  }

  public static fromRow(row: CursorRow): CursorState {
    let events = typeof row.events_ingested === 'string'
      ? parseInt(row.events_ingested, 10)
      : row.events_ingested;
      
    if (isNaN(events as number)) {
      events = 0;
    }

    return new CursorState(row.cursor_value, events as number);
  }

  public toRow(): { cursor_value: string; events_ingested: number } {
    if (this._cursor === null) {
      throw new Error('Cannot serialize CursorState: cursor is null. Must fetch at least one page first.');
    }
    return {
      cursor_value: this._cursor,
      events_ingested: this._eventsIngested
    };
  }

  public update(nextCursor: string, countInBatch: number): void {
    this._cursor = nextCursor;
    this._eventsIngested += countInBatch;
  }
}

import { Pool } from 'pg';

export async function saveCursor(pool: Pool, state: CursorState): Promise<void> {
  if (state.cursor === null) return;
  
  const query = `
    INSERT INTO cursor_state (cursor_value, events_ingested)
    VALUES ($1, $2)
  `;
  await pool.query(query, [state.cursor, state.eventsIngested]);
}

export async function loadCursor(pool: Pool): Promise<CursorState | null> {
  const query = `
    SELECT * FROM cursor_state
    ORDER BY updated_at DESC LIMIT 1
  `;
  const res = await pool.query(query);
  
  if (res.rows.length === 0) {
    return null;
  }
  
  return CursorState.fromRow(res.rows[0]);
}
