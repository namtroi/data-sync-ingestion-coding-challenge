import { describe, it, expect } from 'vitest';
import { normalizeTimestamp, transformEvent, transformEvents } from '../../src/ingestion/transformer';

describe('transformer', () => {
  describe('normalizeTimestamp()', () => {
    it('normalizes ISO string to Date object', () => {
      const iso = '2026-01-27T19:19:13.629Z';
      const date = normalizeTimestamp(iso);
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe(iso);
    });

    it('normalizes Unix epoch ms to Date object', () => {
      const ms = 1769541612369;
      const date = normalizeTimestamp(ms);
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBe(ms);
    });

    it('throws on invalid input', () => {
      expect(() => normalizeTimestamp('invalid-date')).toThrow();
      expect(() => normalizeTimestamp(null as any)).toThrow();
      expect(() => normalizeTimestamp(undefined as any)).toThrow();
    });
  });

  describe('transformEvent()', () => {
    it('transforms raw API event to DB row', () => {
      const raw = {
        id: 'evt-123',
        type: 'click',
        timestamp: 1769541612369,
        userId: 'user-1'
      };
      
      const row = transformEvent(raw);
      expect(row).toEqual({
        id: 'evt-123',
        event_type: 'click',
        timestamp: new Date(1769541612369),
        data: raw
      });
    });

    it('throws if missing id field', () => {
      const raw = {
        type: 'click',
        timestamp: 1769541612369,
      };
      expect(() => transformEvent(raw)).toThrow();
    });
  });

  describe('transformEvents()', () => {
    it('transforms a batch of raw events to batch of rows', () => {
      const raw1 = { id: 'evt-1', type: 'click', timestamp: '2026-01-27T19:19:13.629Z' };
      const raw2 = { id: 'evt-2', type: 'page_view', timestamp: 1769541612369 };
      
      const rows = transformEvents([raw1, raw2]);
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('evt-1');
      expect(rows[1].id).toBe('evt-2');
      expect(rows[0].timestamp).toBeInstanceOf(Date);
      expect(rows[1].timestamp).toBeInstanceOf(Date);
    });
  });
});
