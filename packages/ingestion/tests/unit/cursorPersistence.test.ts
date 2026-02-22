import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveCursor, loadCursor, CursorState } from '../../src/ingestion/cursor';
import { Pool } from 'pg';

describe('Cursor Persistence', () => {
  let mockQuery: any;
  let mockPool: any;

  beforeEach(() => {
    mockQuery = vi.fn();
    mockPool = {
      query: mockQuery
    };
  });

  describe('saveCursor(state)', () => {
    it('inserts/updates cursor_state row', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      
      const state = CursorState.create();
      state.update('curs-123', 500);
      
      await saveCursor(mockPool as unknown as Pool, state);
      
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const args = mockQuery.mock.calls[0];
      expect(args[0]).toContain('INSERT INTO cursor_state');
      expect(args[1]).toEqual(['curs-123', 500]);
    });
  });

  describe('loadCursor()', () => {
    it('returns latest cursor state', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          cursor_value: 'curs-abc',
          events_ingested: '15000',
          updated_at: new Date()
        }]
      });
      
      const state = await loadCursor(mockPool as unknown as Pool);
      expect(state).not.toBeNull();
      expect(state?.cursor).toBe('curs-abc');
      expect(state?.eventsIngested).toBe(15000);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY updated_at DESC LIMIT 1');
    });

    it('empty table -> returns null (fresh start)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      
      const state = await loadCursor(mockPool as unknown as Pool);
      expect(state).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});
