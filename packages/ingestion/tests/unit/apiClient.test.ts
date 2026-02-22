import { describe, it, expect } from 'vitest';
import { createApiClient } from '../../src/api/client';

describe('createApiClient', () => {
  const mockConfig = {
    apiBaseUrl: 'http://test.com/api/v1',
    apiKey: 'test-key',
    streamToken: 'test-token',
  };

  it('creates axios instance with correct base URL and timeout', () => {
    const client = createApiClient(mockConfig);
    expect(client.defaults.baseURL).toBe('http://test.com/api/v1');
    expect(client.defaults.timeout).toBe(10000);
  });

  it('attaches X-API-Key header to every request', () => {
    const client = createApiClient(mockConfig);
    expect(client.defaults.headers['X-API-Key']).toBe('test-key');
  });

  it('attaches X-Stream-Token header when token is configured', () => {
    const client = createApiClient(mockConfig);
    expect(client.defaults.headers['X-Stream-Token']).toBe('test-token');
  });

  it('does not attach X-Stream-Token when not configured', () => {
    const client = createApiClient({ ...mockConfig, streamToken: undefined });
    expect(client.defaults.headers['X-Stream-Token']).toBeUndefined();
  });
});
