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
  streamToken: process.env.STREAM_TOKEN,

  // Worker
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
  batchSize: parseInt(process.env.BATCH_SIZE ?? '1000', 10),

  // Rate limiting
  rateLimitBuffer: parseInt(process.env.RATE_LIMIT_BUFFER ?? '5', 10),
  cursorRefreshThreshold: parseInt(
    process.env.CURSOR_REFRESH_THRESHOLD ?? '60',
    10,
  ),

  // API discovery — hardcoded from Phase 1 manual probing
  api: {
    endpoint: '/events',
    maxLimit: 5000,               // tested: 10000 silently caps to 5000
    rateLimitPerMinute: 10,       // X-RateLimit-Limit: 10, window: 60s
    cursorTTLSeconds: 116,        // pagination.cursorExpiresIn: 116
    retryAfterFormat: 'seconds',  // Retry-After header is integer seconds
    rateLimitErrorCode: 'RATE_LIMIT_EXCEEDED',
  },
} as const;

export type Config = typeof config;
