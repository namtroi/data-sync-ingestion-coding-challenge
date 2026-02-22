# DataSync Ingestion — Requirements Checklist

## Must Have (Critical)

- [ ] **TypeScript** codebase
- [ ] **PostgreSQL** for data storage (provided at `localhost:5434`)
- [ ] **Docker Compose** — solution runs entirely via `sh run-ingestion.sh`
- [ ] **Connect** to DataSync API at `http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1`
- [ ] **Authenticate** using `X-API-Key` header
- [ ] **Extract ALL 3,000,000 events** from the API
- [ ] **Handle cursor-based pagination** (`cursor` query param, `nextCursor` in response)
- [ ] **Respect rate limits** — token bucket synced to `X-RateLimit-*` headers, backoff on 429s
- [ ] **Resumable ingestion** — cursor state saved per batch to DB, resume from last checkpoint on crash
- [ ] **Duplicate handling** — COPY → `staging_events` → INSERT ON CONFLICT DO NOTHING → `ingested_events`
- [ ] **Proper error handling** — 5xx retry with exponential backoff (1s, 2s, 4s, max 3), network timeout retry, auth error fail-fast
- [ ] **Logging** — structured JSON logs via `pino`
- [ ] **Graceful shutdown** — SIGTERM/SIGINT flush buffer → save cursor → close pool → exit
- [ ] **No manual intervention** — fully automated start-to-finish
- [ ] **No external API keys / 3rd party services** — everything runs in Docker
- [ ] **Container name** `assignment-ingestion` and log `"ingestion complete"` (required by `run-ingestion.sh`)

## Should Have (Important)

- [ ] **Throughput optimization** — maximize events/second (60% of evaluation!)
- [ ] **Manual API discovery** — explore dashboard, probe undocumented endpoints, test limit values, analyze headers
- [ ] **Header-based auth** over query param auth (better rate limits per `.env.example` hint)
- [ ] **Adaptive concurrency** — start 5 slots, scale-down to 2 on 3+ consecutive 429s, scale-up +1 after 50 successes (max 10)
- [ ] **Progress tracking** — log events ingested, events/sec, ETA
- [ ] **Timestamp normalization** — handle ISO 8601, Unix epoch (s), Unix epoch (ms) → `TIMESTAMPTZ`
- [ ] **Cursor lifecycle management** — detect stale cursors, reset and re-fetch on expiry
- [ ] **COPY protocol** via UNLOGGED staging table for 5-10x faster bulk inserts
- [ ] **Backpressure** — pause fetching if write buffer exceeds 2 batches
- [ ] **Connection pool tuning** — max: 15, idle: 30s, timeout: 5s

## Nice to Have (Bonus)

- [ ] **Unit tests** — transformer, rateLimiter, cursor, writer
- [ ] **Integration tests** — pipeline with mock API + real DB, COPY performance benchmark
- [ ] **Metrics / monitoring** — health checks, worker health
- [ ] **Architecture documentation** — `docs/architecture.md`

## API Discovery Checklist (Manual — Do Before Coding)

- [ ] Explore dashboard UI (Network tab, JS source, hidden routes)
- [ ] Test `GET /api/v1/events` with different `limit` values (100, 500, 1000, 5000, 10000)
- [ ] Probe undocumented endpoints: `/events/stream`, `/events/bulk`, `/events/export`
- [ ] Read ALL response headers (`X-RateLimit-*`, `Retry-After`, `X-Total-Count`, etc.)
- [ ] Test cursor lifecycle — how long before it expires? (`.env.example` hints ~60s via `CURSOR_REFRESH_THRESHOLD`)
- [ ] Test header auth vs query param auth — confirm rate limit differences
- [ ] Test undocumented query params: `sort`, `fields`, `format`, `since`, `until`
- [ ] Record findings and hardcode into `src/config.ts`

## Submission Checklist

- [ ] Source code in `packages/ingestion/` directory
- [ ] Updated `docker-compose.yml` with ingestion service (container: `assignment-ingestion`)
- [ ] `README.md` with:
  - [ ] How to run the solution (`sh run-ingestion.sh`)
  - [ ] Architecture overview
  - [ ] API discoveries documented (endpoints, limits, cursor TTL, rate limits)
  - [ ] What you'd improve with more time
  - [ ] AI tools used (if any)
- [ ] Export event IDs: `SELECT id FROM ingested_events` → `event_ids.txt`
- [ ] **POST** to `/api/v1/submissions` with event IDs + GitHub repo URL
- [ ] Verify response shows 3,000,000 events
- [ ] Push solution to GitHub

## Key Hints from README & .env.example

| Hint | Source | Implication |
|---|---|---|
| *"The documented API may not be the fastest way"* | README Tips | There are undocumented faster endpoints |
| *"Cursors have a lifecycle"* | README Tips | Cursors expire — use them quickly |
| `CURSOR_REFRESH_THRESHOLD=60` | `.env.example` | Cursors likely expire after ~60 seconds |
| `WORKER_CONCURRENCY=5` | `.env.example` | Default 5 concurrent workers |
| `BATCH_SIZE=100` | `.env.example` | Default page size, but higher may work |
| *"Header-based auth preferred"* | `.env.example` | `X-API-Key` header gets better rate limits |
| `REDIS_HOST` / `REDIS_PORT` | `.env.example` | Redis available but optional (we use `p-limit` instead) |
| *"Good engineers explore every corner"* | README Tips | Explore dashboard, not just API docs |
| API key valid for **3 hours** | README | Plan work to fit within window |
| Max **5 submissions** | README | Don't waste submission attempts |
