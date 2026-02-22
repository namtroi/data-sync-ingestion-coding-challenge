import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pipeline } from '../../src/ingestion/pipeline';
import { Fetcher, FetchPageResult } from '../../src/api/fetcher';
import { DBWriter } from '../../src/db/writer';
import { CursorState, saveCursor, loadCursor } from '../../src/ingestion/cursor';
import { Pool } from 'pg';

vi.mock('../../src/ingestion/cursor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ingestion/cursor')>();
  return {
    ...actual,
    saveCursor: vi.fn(),
    loadCursor: vi.fn(),
  };
});

describe('Pipeline Orchestration', () => {
  let mockFetcher: any;
  let mockWriter: any;
  let mockPool: any;
  let pipeline: Pipeline;

  beforeEach(() => {
    mockFetcher = {
      fetchPage: vi.fn()
    };
    mockWriter = {
      add: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    mockPool = {};
    
    pipeline = new Pipeline(
      mockFetcher as unknown as Fetcher,
      mockWriter as unknown as DBWriter,
      mockPool as unknown as Pool
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const getMockRaw = (id: string) => ({
    id,
    type: 'click',
    timestamp: '2026-01-01T00:00:00Z',
    data: {}
  });

  it('Ingests events from mock API -> stores in real Postgres', async () => {
    // 2 pages
    mockFetcher.fetchPage
      .mockResolvedValueOnce({
        data: [getMockRaw('1'), getMockRaw('2')],
        hasMore: true,
        nextCursor: 'cur-1'
      })
      .mockResolvedValueOnce({
        data: [getMockRaw('3')],
        hasMore: false,
        nextCursor: 'cur-2'
      });
      
    (loadCursor as any).mockResolvedValueOnce(null);

    let progressCount = 0;
    pipeline.onProgress((summary) => {
      progressCount++;
    });

    await pipeline.run();

    // Fetched twice
    expect(mockFetcher.fetchPage).toHaveBeenCalledTimes(2);
    expect(mockFetcher.fetchPage).toHaveBeenNthCalledWith(1, 5000, null);
    expect(mockFetcher.fetchPage).toHaveBeenNthCalledWith(2, 5000, 'cur-1');

    // Wrote twice
    expect(mockWriter.add).toHaveBeenCalledTimes(2);
    const addedRows1 = mockWriter.add.mock.calls[0][0];
    expect(addedRows1).toHaveLength(2);
    expect(addedRows1[0].id).toBe('1');
    expect(addedRows1[1].id).toBe('2');

    // Flushed at end
    expect(mockWriter.close).toHaveBeenCalledTimes(1);
    
    // Progress callback fired
    expect(progressCount).toBeGreaterThan(0);
  });

  it('Saves cursor checkpoint every batch', async () => {
    mockFetcher.fetchPage.mockResolvedValueOnce({
      data: [getMockRaw('1')],
      hasMore: false,
      nextCursor: 'cur-final'
    });
    
    (loadCursor as any).mockResolvedValueOnce(null);
    await pipeline.run();
    
    expect(saveCursor).toHaveBeenCalledTimes(2); // 1 in loop, 1 at flush
    const savedState = (saveCursor as any).mock.calls[0][1];
    expect(savedState.cursor).toBe('cur-final');
    expect(savedState.eventsIngested).toBe(1);
  });

  it('Resumes from checkpoint after simulated crash', async () => {
    const resumeState = CursorState.create();
    resumeState.update('cur-crash-pt', 1000);
    
    (loadCursor as any).mockResolvedValueOnce(resumeState);
    
    mockFetcher.fetchPage.mockResolvedValueOnce({
      data: [getMockRaw('1001')],
      hasMore: false,
      nextCursor: 'cur-end'
    });
    
    await pipeline.run();
    
    // Started reading from crashed cursor
    expect(mockFetcher.fetchPage).toHaveBeenCalledWith(5000, 'cur-crash-pt');
    
    // Check state update
    expect(saveCursor).toHaveBeenCalledTimes(2); // 1 in loop, 1 at flush
    const savedState = (saveCursor as any).mock.calls[0][1];
    expect(savedState.eventsIngested).toBe(1001); // 1000 + 1
  });

  it('Stops when hasMore === false', async () => {
    mockFetcher.fetchPage.mockResolvedValueOnce({
      data: [],
      hasMore: false,
      nextCursor: 'cur-end'
    });
    
    (loadCursor as any).mockResolvedValueOnce(null);
    await pipeline.run();
    expect(mockFetcher.fetchPage).toHaveBeenCalledTimes(1);
  });
});
