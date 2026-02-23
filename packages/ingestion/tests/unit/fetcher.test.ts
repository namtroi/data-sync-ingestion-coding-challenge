import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fetcher, FetchPageResult } from '../../src/api/fetcher';
import { AxiosInstance, AxiosError } from 'axios';

describe('Fetcher', () => {
  let mockClient: any;
  let fetcher: Fetcher;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      get: vi.fn(),
    };
    fetcher = new Fetcher(mockClient as unknown as AxiosInstance, true); // true = hasToken
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const mockSuccessResponse = {
    data: {
      data: [{ id: '1' }],
      pagination: { hasMore: true, nextCursor: 'cur-1' }
    }
  };

  it('fetchPage() — no cursor -> first page', async () => {
    mockClient.get.mockResolvedValueOnce(mockSuccessResponse);
    const result = await fetcher.fetchPage(5000);
    
    expect(mockClient.get).toHaveBeenCalledWith(expect.any(String), {
      params: { limit: 5000 }
    });
    expect(result.data).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cur-1');
  });

  it('fetchPage() — with cursor -> specific page', async () => {
    mockClient.get.mockResolvedValueOnce(mockSuccessResponse);
    await fetcher.fetchPage(5000, 'cur-5');
    
    expect(mockClient.get).toHaveBeenCalledWith(expect.any(String), {
      params: { limit: 5000, cursor: 'cur-5' }
    });
  });

  it('fetchPage() — uses stream endpoint when token available', async () => {
    mockClient.get.mockResolvedValueOnce(mockSuccessResponse);
    await fetcher.fetchPage(5000);
    
    expect(mockClient.get).toHaveBeenCalledWith('/events/d4ta/x7k9/feed', expect.any(Object));
  });

  it('fetchPage() — falls back to standard endpoint when no token', async () => {
    const fallbackFetcher = new Fetcher(mockClient as unknown as AxiosInstance, false);
    mockClient.get.mockResolvedValueOnce(mockSuccessResponse);
    await fallbackFetcher.fetchPage(5000);
    
    expect(mockClient.get).toHaveBeenCalledWith('/events', expect.any(Object));
  });

  it('fetchPage() — API returns 500 -> retries with exponential backoff (max 3)', async () => {
    const error500 = Object.assign(new Error(), { isAxiosError: true, response: { status: 500 } });
    
    mockClient.get
      .mockRejectedValueOnce(error500)
      .mockRejectedValueOnce(error500)
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce(mockSuccessResponse);
      
    const promise = fetcher.fetchPage(5000);
    
    // Fast forward to exhaust retries
    for (let i = 0; i < 3; i++) {
      await vi.runAllTimersAsync();
    }
    
    const result = await promise;
    expect(mockClient.get).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(result.data).toHaveLength(1);
  });

  it('fetchPage() — network timeout -> retries up to 3 times', async () => {
    const errorTimeout = Object.assign(new Error(), { isAxiosError: true, code: 'ECONNABORTED' });
    
    mockClient.get.mockRejectedValue(errorTimeout);
    
    let caughtError;
    const promise = fetcher.fetchPage(5000).catch(e => { caughtError = e; });
    
    for (let i = 0; i < 3; i++) {
      await vi.runAllTimersAsync();
    }
    
    await promise;
    expect(caughtError).toBeDefined();
    expect(mockClient.get).toHaveBeenCalledTimes(4); // max out retries
  });

  it('fetchPage() — API returns 401/403 -> throws auth error (no retry)', async () => {
    const fallbackFetcher = new Fetcher(mockClient as unknown as AxiosInstance, false);
    const error403 = Object.assign(new Error(), { isAxiosError: true, response: { status: 403 } });
    mockClient.get.mockRejectedValueOnce(error403);
    
    await expect(fallbackFetcher.fetchPage(5000)).rejects.toThrow(/auth/i);
    expect(mockClient.get).toHaveBeenCalledTimes(1);
  });

  it('fetchPage() — stream endpoint returns 403 -> throws STREAM_TOKEN_EXPIRED', async () => {
    const error403 = Object.assign(new Error(), { isAxiosError: true, response: { status: 403 } });
    mockClient.get.mockRejectedValueOnce(error403);
    
    await expect(fetcher.fetchPage(5000)).rejects.toThrow('STREAM_TOKEN_EXPIRED');
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith('/events/d4ta/x7k9/feed', expect.any(Object));
  });
});
