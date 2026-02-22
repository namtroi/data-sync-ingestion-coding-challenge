# Architecture — Stream-Based Ingestion

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript 5 | Async/await native |
| HTTP | `axios` | Interceptors for retry. Response headers easy to read |
| DB | PostgreSQL 16 + `pg` | `COPY` protocol for fastest inserts |
| Testing | `vitest` | Fast, native TS/ESM, built-in mocking |
| Container | Docker multi-stage | Small image, fast rebuilds |
| Config | `dotenv` | Load `.env` for local dev |
| Logging | `pino` | Structured JSON, low overhead |

## Directory Structure

```
packages/ingestion/
├── Dockerfile
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # entrypoint — linear fetch loop
│   ├── config.ts             # env vars, API settings
│   ├── db/
│   │   ├── client.ts         # pg pool setup
│   │   ├── migrations.ts     # create tables on startup
│   │   └── writer.ts         # COPY → staging → upsert
│   ├── api/
│   │   ├── client.ts         # axios instance, auth headers
│   │   └── fetcher.ts        # fetch page with stream token
│   ├── ingestion/
│   │   ├── pipeline.ts       # sequential fetch → transform → write loop
│   │   ├── cursor.ts         # cursor state management (save/resume)
│   │   └── transformer.ts    # normalize timestamps, map fields
│   └── utils/
│       ├── logger.ts         # pino wrapper
│       └── progress.ts       # events/sec, ETA tracker
└── tests/
    ├── unit/
    │   ├── transformer.test.ts
    │   ├── cursor.test.ts
    │   └── writer.test.ts
    └── integration/
        ├── pipeline.test.ts
        └── db.test.ts
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                 index.ts (main)                  │
│  1. Run migrations                               │
│  2. Load cursor state (resume point)             │
│  3. Start pipeline (sequential fetch loop)       │
│  4. Log "ingestion complete" + final stats       │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│              pipeline.ts                          │
│                                                   │
│  while (hasMore) {                                │
│    page = fetcher.fetchPage(cursor)               │
│         │                                         │
│         ▼                                         │
│    rows = transformer.normalize(page.data)        │
│         │                                         │
│         ▼                                         │
│    writer.writeBatch(rows)                        │
│         │                                         │
│         ▼                                         │
│    cursor.save(page.pagination.nextCursor)        │
│  }                                                │
└──────────────────────────────────────────────────┘
```

## Why No Rate Limiter?

The stream endpoint (`/api/v1/events/d4ta/x7k9/feed`) has **no rate limit**. 60 consecutive requests tested, all 200. No token bucket, no 429 backoff, no adaptive concurrency needed.

Only constraint: **Stream token expires in 300s**. Token is passed via env var `STREAM_TOKEN` at startup. Ingestion must complete within that window (feasible for 3M events at ~5000/req with no throttling).

Fallback: if stream token expires mid-run, fall back to standard endpoint (10 req/60s).

## DB Schema

```sql
CREATE TABLE IF NOT EXISTS ingested_events (
    id          TEXT PRIMARY KEY,
    event_type  TEXT,
    timestamp   TIMESTAMPTZ,
    data        JSONB NOT NULL,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging_events (
    id          TEXT,
    event_type  TEXT,
    timestamp   TIMESTAMPTZ,
    data        JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cursor_state (
    id              SERIAL PRIMARY KEY,
    cursor_value    TEXT NOT NULL,
    events_ingested BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### COPY + Dedup Workflow

```sql
-- 1. COPY into unlogged staging (fastest insert)
COPY staging_events (id, event_type, timestamp, data) FROM STDIN;

-- 2. Upsert from staging → main
INSERT INTO ingested_events (id, event_type, timestamp, data)
SELECT id, event_type, timestamp, data FROM staging_events
ON CONFLICT (id) DO NOTHING;

-- 3. Truncate staging
TRUNCATE staging_events;
```

## Data Flow

```
Stream API ──fetch──▶ Raw JSON ──transform──▶ Normalized Row ──COPY──▶ staging_events
                                                                           │
                                                              INSERT ON CONFLICT DO NOTHING
                                                                           │
                                                                    ingested_events
                                                                           │
                                                                  save cursor ──▶ cursor_state
```

## Timestamp Normalization

API returns **mixed formats in the same response**:
- ISO 8601: `"2026-01-27T19:20:12.369Z"`
- Unix ms: `1769541612369`

`transformer.ts` detects and normalizes both → `TIMESTAMPTZ`.

## Resumability

```
Startup:
  1. Query cursor_state (ORDER BY updated_at DESC LIMIT 1)
  2. If exists → resume from cursor_value
  3. If not → start from beginning

During ingestion:
  4. Every batch → save cursor + count

Crash recovery:
  5. Restart → picks up from last checkpoint
  6. Duplicates handled by ON CONFLICT DO NOTHING
```

## Graceful Shutdown

```
On SIGTERM / SIGINT:
  1. Set shouldStop flag
  2. Finish current fetch + write
  3. Save cursor state
  4. Close DB pool
  5. Exit
```

## Docker

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
ingestion:
  build: ./packages/ingestion
  container_name: assignment-ingestion
  environment:
    DATABASE_URL: postgresql://postgres:postgres@postgres:5432/ingestion
    API_BASE_URL: http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1
    TARGET_API_KEY: ${TARGET_API_KEY}
    STREAM_TOKEN: ${STREAM_TOKEN}
  depends_on:
    postgres:
      condition: service_healthy
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Stream endpoint | No rate limit → unlimited throughput → sub-30-min ingestion |
| Sequential loop (no p-limit) | No rate limit = no need for concurrency pool. Simple loop is faster than coordinating slots |
| `COPY` → staging → upsert | `COPY` is 5-10x faster than INSERT; staging handles dedup |
| Cursor saved per batch | Reduces DB writes while keeping resumability |
| Token via env var | Simple. Get token from dashboard console, set `STREAM_TOKEN`, run. |
| Fallback to standard endpoint | If token expires, degrade to 10 req/60s instead of crashing |

## Connection Pool

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```
