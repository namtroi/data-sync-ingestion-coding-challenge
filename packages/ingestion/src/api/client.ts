import axios, { AxiosInstance } from 'axios';

export interface ApiClientConfig {
  apiBaseUrl: string;
  apiKey: string;
  streamToken?: string;
}

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const headers: Record<string, string> = {
    'X-API-Key': config.apiKey,
  };

  if (config.streamToken) {
    headers['X-Stream-Token'] = config.streamToken;
  }

  return axios.create({
    baseURL: config.apiBaseUrl,
    timeout: 10000,
    headers,
  });
}
