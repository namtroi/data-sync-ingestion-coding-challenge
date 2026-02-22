import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (two levels up from src/)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  // Database
  databaseUrl: requireEnv('DATABASE_URL'),

  // API — must be set via env vars (no defaults)
  apiBaseUrl: requireEnv('API_BASE_URL'),
  apiKey: requireEnv('TARGET_API_KEY'),

  // Worker
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
  batchSize: parseInt(process.env.BATCH_SIZE ?? '1000', 10),

  // Rate limiting
  rateLimitBuffer: parseInt(process.env.RATE_LIMIT_BUFFER ?? '5', 10),
  cursorRefreshThreshold: parseInt(
    process.env.CURSOR_REFRESH_THRESHOLD ?? '60',
    10,
  ),

  // API discovery — will be updated in Phase 1
  api: {
    endpoint: '/events',
    limit: 1000,
    rateLimitPerMinute: 60,
    cursorTTLMinutes: 10,
  },
} as const;

export type Config = typeof config;
