# Architecture — Adaptive Single-Process Async Ingestion

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript 5 | Required. Async/await native |
| HTTP | `axios` | Interceptors for retry/rate-limit. Response headers easy to read |
| DB | PostgreSQL 16 + `pg` (node-postgres) | Required. `COPY` protocol for fastest inserts |
| Concurrency | `p-limit` | Lightweight async concurrency pool, no Redis needed |
| Testing | `vitest` | Fast, native TS/ESM, built-in mocking |
| Container | Docker multi-stage build | Small image, fast rebuilds |
| Config | `dotenv` | Load `.env` for local dev; no-ops gracefully in Docker |
| Logging | `pino` | Structured JSON, low overhead |

## Directory Structure

```
packages/ingestion/
├── Dockerfile
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # entrypoint — orchestrates phases
│   ├── config.ts             # env vars, constants, discovered API settings
│   ├── db/
│   │   ├── client.ts         # pg pool setup (max: 10-20 connections)
│   │   ├── migrations.ts     # create tables on startup
│   │   └── writer.ts         # batch insert via COPY → staging → upsert
│   ├── api/
│   │   ├── client.ts         # axios instance, auth headers
│   │   ├── fetcher.ts        # fetch single page using fastest known endpoint
│   │   └── rateLimiter.ts    # token bucket from response headers
│   ├── ingestion/
│   │   ├── pipeline.ts       # async concurrency pool orchestration
│   │   ├── cursor.ts         # cursor state management (save/resume)
│   │   └── transformer.ts    # normalize timestamps, map fields
│   └── utils/
│       ├── logger.ts         # pino wrapper
│       └── progress.ts       # events/sec, ETA tracker
└── tests/
    ├── unit/
    │   ├── rateLimiter.test.ts
    │   ├── transformer.test.ts
    │   ├── cursor.test.ts
    │   └── writer.test.ts
    └── integration/
        ├── pipeline.test.ts
        └── db.test.ts
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   index.ts (main)                    │
│  1. Register SIGTERM/SIGINT handlers                 │
│  2. Run migrations                                   │
│  3. Load cursor state (resume point)                 │
│  4. Start pipeline                                   │
│  5. Log "ingestion complete" + final stats           │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│              pipeline.ts                          │
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │ Slot 1  │  │ Slot 2  │  │ Slot N  │  ← p-limit│
│  │ fetch() │  │ fetch() │  │ fetch() │           │
│  └────┬────┘  └────┬────┘  └────┬────┘          │
│       │            │            │                 │
│       └────────────┴────────────┘                 │
│                    │                              │
│                    ▼                              │
│  ┌─────────────────────────────┐                 │
│  │  rateLimiter.ts             │                 │
│  │  Token bucket, 429 backoff  │                 │
│  └─────────────────────────────┘                 │
│                    │                              │
│                    ▼                              │
│  ┌─────────────────────────────┐                 │
│  │  transformer.ts             │                 │
│  │  Normalize timestamps       │                 │
│  │  Map fields → DB schema     │                 │
│  └─────────────────────────────┘                 │
│                    │                              │
│                    ▼                              │
│  ┌─────────────────────────────┐                 │
│  │  writer.ts                  │                 │
│  │  COPY → staging table       │                 │
│  │  INSERT ON CONFLICT → main  │                 │
│  │  Flush every 5000-10000 rows│                 │
│  └─────────────────────────────┘                 │
│                    │                              │
│                    ▼                              │
│  ┌─────────────────────────────┐                 │
│  │  cursor.ts                  │                 │
│  │  Save checkpoint to DB      │                 │
│  └─────────────────────────────┘                 │
└──────────────────────────────────────────────────┘
```

## API Discovery (Manual)

API discovery is done **manually before implementation**, not at runtime. Findings are hardcoded into `config.ts`.

### Discovery Checklist

- [ ] Explore the dashboard UI (network tab, JS source, hidden routes)
- [ ] Test `GET /api/v1/events` with different `limit` values (100, 500, 1000, 5000, 10000)
- [ ] Look for undocumented endpoints: `/events/stream`, `/events/bulk`, `/events/export`
- [ ] Read ALL response headers (`X-RateLimit-*`, `Retry-After`, `Content-Type`, etc.)
- [ ] Test cursor lifecycle — how long before a cursor expires?
- [ ] Check if there are undocumented query params (sort, fields, format, etc.)
- [ ] Test authentication methods — header vs query param rate limit differences

### Discovered Config (fill in after exploration)

```typescript
// config.ts — hardcoded from manual API discovery
export const API_CONFIG = {
  baseUrl: 'http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1',
  endpoint: '/events',        // or fastest discovered endpoint
  limit: 1000,                // max accepted limit (update after testing)
  rateLimitPerMinute: 100,    // from X-RateLimit-Limit header (update after testing)
  cursorTTLMinutes: 10,       // how long before cursor expires (update after testing)
};
```

## DB Schema

```sql
-- events table
CREATE TABLE IF NOT EXISTS ingested_events (
    id          TEXT PRIMARY KEY,
    event_type  TEXT,
    timestamp   TIMESTAMPTZ,
    data        JSONB NOT NULL,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

-- staging table for COPY + dedup workflow
CREATE UNLOGGED TABLE IF NOT EXISTS staging_events (
    id          TEXT,
    event_type  TEXT,
    timestamp   TIMESTAMPTZ,
    data        JSONB NOT NULL
);

-- cursor/progress state (resumability)
CREATE TABLE IF NOT EXISTS cursor_state (
    id              SERIAL PRIMARY KEY,
    cursor_value    TEXT NOT NULL,
    events_ingested BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### COPY + Dedup Workflow

PostgreSQL `COPY` does not support `ON CONFLICT`, so we use a two-step approach:

```sql
-- Step 1: COPY raw data into unlogged staging table (fastest possible insert)
COPY staging_events (id, event_type, timestamp, data) FROM STDIN;

-- Step 2: Upsert from staging → main table
INSERT INTO ingested_events (id, event_type, timestamp, data)
SELECT id, event_type, timestamp, data FROM staging_events
ON CONFLICT (id) DO NOTHING;

-- Step 3: Truncate staging for next batch
TRUNCATE staging_events;
```

## Data Flow

```
API  ──fetch──▶  Raw JSON  ──transform──▶  Normalized Row  ──COPY──▶  staging_events
                                                                           │
                                                              INSERT ON CONFLICT DO NOTHING
                                                                           │
                                                                    ingested_events
                                                                           │
                                                                  save cursor ──▶ cursor_state
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Single process, async pool | Saturates API rate limit without Redis overhead |
| `COPY` → staging → upsert | `COPY` is 5-10x faster; staging table handles dedup |
| Manual API discovery | Faster than runtime probing; uses precious API time efficiently |
| Cursor saved per batch (not per row) | Reduces DB writes while keeping resumability |
| `p-limit` concurrency (start: 5) | Simple, no worker threads, no IPC overhead |
| `pino` structured logging | JSON logs, easy to parse, low perf impact |
| Graceful shutdown handlers | Prevents data loss on container stop |
| `UNLOGGED` staging table | Skips WAL for staging, faster writes |

## Concurrency Strategy

```
Initial concurrency:     5 slots (p-limit)
Scale-down trigger:      3+ consecutive 429 responses → reduce to 2 slots
Scale-up trigger:        50 consecutive successes → add 1 slot (max 10)
429 backoff:             Read Retry-After header → sleep exact duration
5xx retry:               Exponential backoff: 1s, 2s, 4s, 8s (max 3 retries)
Network timeout:         10s per request, retry up to 3 times
```

## Rate Limit Strategy

```
1. Read headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
2. Maintain in-memory token bucket synced to headers
3. On 429 → read Retry-After header → sleep exact duration
4. Adaptive concurrency: reduce pool size on repeated 429s, increase on success streaks
```

## Timestamp Normalization

The API may return timestamps in different formats. `transformer.ts` normalizes all to `TIMESTAMPTZ`:

```
Input formats handled:
  - ISO 8601:   "2024-01-15T10:30:00.000Z"
  - Unix epoch:  1705312200
  - Unix ms:     1705312200000

Output: TIMESTAMPTZ in ISO 8601 format
```

## Resumability Flow

```
Startup:
  1. Query cursor_state for latest row (ORDER BY updated_at DESC LIMIT 1)
  2. If exists → set cursor = cursor_value, skip already-ingested pages
  3. If not → start from beginning (no cursor param)

During ingestion:
  4. Every batch → UPDATE cursor_state with current cursor + count

Crash recovery:
  5. Restart container → Step 1 picks up from last checkpoint
  6. Duplicate events handled by ON CONFLICT DO NOTHING in upsert step
  7. Stale cursor → catch error, reset cursor, re-fetch from last known good state
```

## Graceful Shutdown

```
On SIGTERM / SIGINT:
  1. Stop accepting new fetch tasks
  2. Wait for in-flight fetches to complete (with 5s timeout)
  3. Flush remaining write buffer to DB
  4. Save current cursor state
  5. Close DB pool connections
  6. Log "ingestion complete" or "ingestion interrupted" with final stats
  7. Exit process
```

## Docker Integration

### Contracts with `run-ingestion.sh`

| Contract | Value |
|---|---|
| Container name | `assignment-ingestion` |
| Completion signal | Log message containing `"ingestion complete"` |
| DB table | `ingested_events` with row count trackable via `SELECT COUNT(*)` |
| Depends on | `postgres` service with `service_healthy` condition |

### Dockerfile (Multi-stage)

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

### docker-compose.yml (ingestion service)

```yaml
ingestion:
  build: ./packages/ingestion
  container_name: assignment-ingestion
  environment:
    DATABASE_URL: postgresql://postgres:postgres@postgres:5432/ingestion
    API_BASE_URL: http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1
    API_KEY: ${API_KEY}
  depends_on:
    postgres:
      condition: service_healthy
  networks:
    - assignment-network
```

## Memory Management

```
Batch size:          5000-10000 events per flush
Max buffer memory:   ~50MB (estimated for 10000 JSONB rows)
Backpressure:        Pause fetching if write buffer > 2 batches
```

## TDD Approach — Test Order

Build bottom-up. Each layer tested before integration:

```
Phase 1: Pure logic (no I/O)
  1. transformer.test.ts   — timestamp normalization, field mapping
  2. rateLimiter.test.ts   — token bucket logic, backoff calculation
  3. cursor.test.ts        — state serialization/deserialization

Phase 2: I/O with mocks
  4. writer.test.ts        — batch buffering, flush trigger, staging table flow (mock pg)

Phase 3: Integration
  5. db.test.ts            — real Postgres via testcontainers
  6. pipeline.test.ts      — end-to-end with mock API + real DB
```

## Connection Pool Config

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,                    // concurrent connections
  idleTimeoutMillis: 30000,   // close idle connections after 30s
  connectionTimeoutMillis: 5000,
});
```
