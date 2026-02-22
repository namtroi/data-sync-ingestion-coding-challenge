import { AxiosInstance, AxiosError } from 'axios';
import { RawEvent } from '../ingestion/transformer.js';

export interface FetchPageResult {
  data: RawEvent[];
  hasMore: boolean;
  nextCursor: string;
}

export class Fetcher {
  private baseEndpoint = '/events';
  private streamEndpoint = '/events/d4ta/x7k9/feed';

  constructor(
    private client: AxiosInstance,
    private hasStreamToken: boolean
  ) {}

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public async fetchPage(limit: number, cursor?: string | null): Promise<FetchPageResult> {
    const endpoint = this.hasStreamToken ? this.streamEndpoint : this.baseEndpoint;
    const params: Record<string, any> = { limit };
    if (cursor) {
      params.cursor = cursor;
    }

    let attempt = 0;
    const maxRetries = 3;

    while (attempt <= maxRetries) {
      try {
        const response = await this.client.get(endpoint, { params });
        const { data, pagination } = response.data;
        return {
          data,
          hasMore: pagination.hasMore,
          nextCursor: pagination.nextCursor
        };
      } catch (err) {
        if (err !== null && typeof err === 'object' && 'isAxiosError' in err) {
          const axiosError = err as AxiosError;
          const status = axiosError.response?.status;
          
          if (status === 401 || status === 403) {
            throw new Error(`Auth error (${status}). Please check API Key and Stream Token.`);
          }
          
          const isNetworkError = !axiosError.response || axiosError.code === 'ECONNABORTED';
          const isServerError = status && status >= 500;
          const isRateLimit = status === 429;
          
          if (isNetworkError || isServerError || isRateLimit) {
            if (attempt < maxRetries) {
              attempt++;
              let delayMs = Math.pow(2, attempt) * 500; // Exponential backoff: 1s, 2s, 4s
              
              if (isRateLimit && axiosError.response?.headers['retry-after']) {
                // Respect Retry-After header (in seconds)
                const retryAfter = parseInt(axiosError.response.headers['retry-after'], 10);
                if (!isNaN(retryAfter)) {
                  delayMs = retryAfter * 1000;
                }
              }
              
              await this.delay(delayMs);
              continue;
            }
          }
        }
        throw err;
      }
    }
    
    throw new Error('Unreachable code');
  }
}
