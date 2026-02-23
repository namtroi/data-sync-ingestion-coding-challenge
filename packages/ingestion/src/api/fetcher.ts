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

  public get isStreamMode(): boolean {
    return this.hasStreamToken;
  }

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

    while (true) {
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
          const isStreamEndpoint = endpoint === this.streamEndpoint;
          
          if (status === 401 || status === 403) {
            if (isStreamEndpoint) {
                console.warn('⚠️  Stream token expired! Get a new one and restart. Progress is saved.');
                // Signal to pipeline to stop and save cursor
                throw new Error('STREAM_TOKEN_EXPIRED');
            }
            throw new Error(`Auth error (${status}). Please check your API Key.`);
          }
          
          // 400: cursor expired — retry without cursor (start from beginning, dedup handles the rest)
          if (status === 400) {
            const responseData = axiosError.response?.data as any;
            if (responseData?.code === 'CURSOR_EXPIRED' && cursor) {
              console.warn('⚠️  Cursor expired. Restarting from beginning (duplicates handled by ON CONFLICT).');
              delete params.cursor;
              cursor = null;
              continue;
            }
          }
          
          // 429: always wait and retry (never crash on rate limits)
          if (status === 429) {
            const retryAfter = parseInt(axiosError.response?.headers['retry-after'] ?? '60', 10);
            console.warn(`Rate limited (429). Waiting ${retryAfter + 1}s before retry...`);
            await this.delay((retryAfter + 1) * 1000);
            continue;
          }
          
          // Network/server errors: retry up to maxRetries
          const isNetworkError = !axiosError.response || axiosError.code === 'ECONNABORTED';
          const isServerError = status && status >= 500;
          
          if ((isNetworkError || isServerError) && attempt < maxRetries) {
            attempt++;
            await this.delay(Math.pow(2, attempt) * 500);
            continue;
          }
        }
        throw err;
      }
    }
  }
}
