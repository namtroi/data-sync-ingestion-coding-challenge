import { describe, it, expect } from 'vitest';
import { CursorState } from '../../src/ingestion/cursor';

describe('CursorState', () => {
  describe('create()', () => {
    it('creates initial state with null cursor and 0 events', () => {
      const state = CursorState.create();
      expect(state.cursor).toBeNull();
      expect(state.eventsIngested).toBe(0);
    });
  });

  describe('fromRow()', () => {
    it('deserializes DB row to CursorState object', () => {
      const row = {
        id: 1,
        cursor_value: 'some-base64-cursor',
        events_ingested: '15000', // pg can return int8 (bigint) as strings
        updated_at: new Date('2026-01-27T19:19:13.629Z')
      };
      
      const state = CursorState.fromRow(row);
      expect(state.cursor).toBe('some-base64-cursor');
      expect(state.eventsIngested).toBe(15000);
    });

    it('handles numeric events_ingested correctly', () => {
      const row = {
        id: 1,
        cursor_value: 'cursor-text',
        events_ingested: 500,
        updated_at: new Date()
      };
      
      const state = CursorState.fromRow(row);
      expect(state.eventsIngested).toBe(500);
    });
  });

  describe('toRow()', () => {
    it('serializes CursorState to DB row values', () => {
      const state = CursorState.create();
      state.update('next-cursor', 500);
      
      const row = state.toRow();
      expect(row).toEqual({
        cursor_value: 'next-cursor',
        events_ingested: 500
      });
    });

    it('throws if cursor is null', () => {
      const state = CursorState.create();
      expect(() => state.toRow()).toThrow();
    });
  });

  describe('update()', () => {
    it('updates cursor value and events count', () => {
      const state = CursorState.create();
      state.update('cursor-1', 100);
      expect(state.cursor).toBe('cursor-1');
      expect(state.eventsIngested).toBe(100);
      
      state.update('cursor-2', 50);
      expect(state.cursor).toBe('cursor-2');
      expect(state.eventsIngested).toBe(150);
    });
  });
});
