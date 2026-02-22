# TDD Implementation Plan

## Overview

Build the ingestion system bottom-up using TDD. Write failing tests first, then implement to pass. Each step produces a working, tested module before moving to the next.

---

## Phase 0: Project Scaffolding

- [x] Init `packages/ingestion/` with `npm init`
- [x] Install deps: `typescript`, `vitest`, `axios`, `pg`, `p-limit`, `pino`, `dotenv`
- [x] Install dev deps: `@types/pg`, `@types/node`, `tsx`
- [x] Create `tsconfig.json` (strict, ESM, outDir: `dist`)
- [x] Create `vitest.config.ts`
- [x] Create `src/config.ts` — load env vars with defaults
- [x] Create `src/utils/logger.ts` — pino wrapper
- [x] Verify: `npx vitest run` exits clean (no tests yet, no errors)

---

## Phase 1: Manual API Discovery

> **Goal:** Explore the API and dashboard manually. Document findings. Hardcode optimal settings into `config.ts`.
> This phase does NOT involve writing ingestion code — only exploration and documentation.

### Step 1.1: Dashboard Exploration

- [ ] Open dashboard: `http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com`
- [ ] Inspect Network tab — note all API calls the UI makes
- [ ] Inspect JS source — look for hidden endpoints, params, or auth patterns
- [ ] Document any undocumented routes discovered

### Step 1.2: API Endpoint Probing

- [ ] Test `GET /api/v1/events` — confirm basic pagination works
- [ ] Test different `limit` values: 100, 500, 1000, 5000, 10000
- [ ] Record max accepted `limit` value
- [ ] Probe undocumented endpoints:
  - [ ] `GET /api/v1/events/stream` (SSE/streaming?)
  - [ ] `GET /api/v1/events/bulk` (bulk export?)
  - [ ] `GET /api/v1/events/export` (file download?)
  - [ ] Any other endpoints found from dashboard inspection
- [ ] Test query params: `sort`, `fields`, `format`, `since`, `until`, etc.

### Step 1.3: Rate Limit & Header Analysis

- [ ] Record rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- [ ] Test if header-based auth (`X-API-Key`) has different rate limits than query param auth
- [ ] Trigger a 429 — record `Retry-After` header format (seconds or date)
- [ ] Estimate max sustainable requests per minute

### Step 1.4: Cursor Lifecycle

- [ ] Get a cursor from first request
- [ ] Test cursor after 5, 10, 15 minutes — when does it expire?
- [ ] Record cursor TTL
- [ ] Test what error is returned for a stale/expired cursor

### Step 1.5: Update Config

- [ ] Update `src/config.ts` with discovered values:
  ```typescript
  export const API_CONFIG = {
    endpoint: '/events',      // or fastest discovered endpoint
    limit: ???,                // max accepted limit
    rateLimitPerMinute: ???,   // from headers
    cursorTTLMinutes: ???,     // from testing
  };
  ```
- [ ] Document all findings in `README.md` > API Discoveries section

---

## Phase 2: Pure Logic — No I/O

### Step 2.1: Transformer

> Normalize timestamps, map raw API fields → DB row format

- [ ] **TEST** `tests/unit/transformer.test.ts`
  - [ ] `normalizeTimestamp()` — ISO string → Date object
  - [ ] `normalizeTimestamp()` — Unix epoch seconds → Date object
  - [ ] `normalizeTimestamp()` — Unix epoch ms → Date object
  - [ ] `normalizeTimestamp()` — already a Date → passthrough
  - [ ] `normalizeTimestamp()` — invalid input → throws
  - [ ] `transformEvent()` — raw API event → `{ id, event_type, timestamp, data }` row
  - [ ] `transformEvent()` — missing `id` field → throws
  - [ ] `transformEvents()` — batch of raw events → batch of rows
- [ ] **IMPLEMENT** `src/ingestion/transformer.ts`
- [ ] **VERIFY** all tests green

### Step 2.2: Rate Limiter

> Token bucket + 429 backoff logic + adaptive concurrency

- [ ] **TEST** `tests/unit/rateLimiter.test.ts`
  - [ ] `constructor` — initializes with default tokens
  - [ ] `updateFromHeaders()` — parses `X-RateLimit-Limit`, `Remaining`, `Reset`
  - [ ] `canProceed()` — true when tokens > 0
  - [ ] `canProceed()` — false when tokens = 0
  - [ ] `consume()` — decrements token count
  - [ ] `getBackoffMs()` — returns 0 when tokens available
  - [ ] `getBackoffMs()` — returns ms until reset when tokens = 0
  - [ ] `handleRetryAfter()` — parses `Retry-After` header (seconds)
  - [ ] `handleRetryAfter()` — parses `Retry-After` header (date string)
  - [ ] Adaptive: reduces concurrency after 3+ consecutive 429s → suggests 2 slots
  - [ ] Adaptive: increases concurrency after 50 consecutive successes → suggests +1 slot (max 10)
- [ ] **IMPLEMENT** `src/api/rateLimiter.ts`
- [ ] **VERIFY** all tests green

### Step 2.3: Cursor State

> Serialize/deserialize cursor checkpoint data

- [ ] **TEST** `tests/unit/cursor.test.ts`
  - [ ] `CursorState.create()` — creates initial state (null cursor, 0 events)
  - [ ] `CursorState.fromRow()` — deserializes DB row → CursorState object
  - [ ] `CursorState.toRow()` — serializes CursorState → DB row values
  - [ ] `CursorState.update()` — updates cursor value + event count
  - [ ] `isStale()` — returns true if cursor age > configured TTL
  - [ ] `isStale()` — returns false if cursor is fresh
- [ ] **IMPLEMENT** `src/ingestion/cursor.ts`
- [ ] **VERIFY** all tests green

### Step 2.4: Progress Tracker

> events/sec calculation, ETA estimation

- [ ] **TEST** `tests/unit/progress.test.ts`
  - [ ] `start()` — records start time
  - [ ] `update(count)` — tracks total events ingested
  - [ ] `getEventsPerSecond()` — calculates throughput
  - [ ] `getETA(totalEvents)` — estimates remaining time
  - [ ] `getSummary()` — returns formatted progress string
- [ ] **IMPLEMENT** `src/utils/progress.ts`
- [ ] **VERIFY** all tests green

---

## Phase 3: I/O with Mocks

### Step 3.1: API Client

> Axios instance, auth headers, base URL config

- [ ] **TEST** `tests/unit/apiClient.test.ts`
  - [ ] Creates axios instance with correct base URL
  - [ ] Attaches `X-API-Key` header to every request
  - [ ] Timeout configured (10s)
- [ ] **IMPLEMENT** `src/api/client.ts`
- [ ] **VERIFY** all tests green

### Step 3.2: Fetcher

> Fetch single page from API using fastest known endpoint, parse response

- [ ] **TEST** `tests/unit/fetcher.test.ts`
  - [ ] `fetchPage(cursor?)` — returns `{ data, hasMore, nextCursor }`
  - [ ] `fetchPage()` — no cursor → first page
  - [ ] `fetchPage()` — with cursor → specific page
  - [ ] `fetchPage()` — uses discovered `limit` from config
  - [ ] `fetchPage()` — API returns 429 → triggers rate limiter wait + retry
  - [ ] `fetchPage()` — API returns 500 → retries with exponential backoff (1s, 2s, 4s, max 3)
  - [ ] `fetchPage()` — API returns 401 → throws auth error (no retry)
  - [ ] `fetchPage()` — network timeout → retries up to 3 times
  - [ ] Extracts rate limit headers from response
- [ ] **IMPLEMENT** `src/api/fetcher.ts`
- [ ] **VERIFY** all tests green

### Step 3.3: DB Writer (COPY + Staging + Upsert)

> Batch buffer + COPY → staging → INSERT ON CONFLICT workflow

- [ ] **TEST** `tests/unit/writer.test.ts`
  - [ ] `add(rows)` — buffers rows in memory
  - [ ] `add(rows)` — auto-flushes when buffer reaches batch size (5000-10000)
  - [ ] `flush()` — COPY rows into `staging_events` table
  - [ ] `flush()` — INSERT from `staging_events` into `ingested_events` ON CONFLICT DO NOTHING
  - [ ] `flush()` — TRUNCATE `staging_events` after upsert
  - [ ] `flush()` — empty buffer → no-op
  - [ ] `close()` — flushes remaining + releases connection
  - [ ] Backpressure — pauses accepting rows if buffer exceeds 2 batches
- [ ] **IMPLEMENT** `src/db/writer.ts`
- [ ] **VERIFY** all tests green

### Step 3.4: DB Migrations

> Create tables on startup (including staging table)

- [ ] **TEST** `tests/unit/migrations.test.ts`
  - [ ] `runMigrations()` — creates `ingested_events` table (id, event_type, timestamp, data, ingested_at)
  - [ ] `runMigrations()` — creates `staging_events` UNLOGGED table
  - [ ] `runMigrations()` — creates `cursor_state` table
  - [ ] Idempotent — running twice doesn't error
- [ ] **IMPLEMENT** `src/db/migrations.ts`
- [ ] **VERIFY** all tests green

### Step 3.5: Cursor Persistence

> Save/load cursor state to/from DB

- [ ] **TEST** `tests/unit/cursorPersistence.test.ts`
  - [ ] `saveCursor(state)` — inserts/updates cursor_state row
  - [ ] `loadCursor()` — returns latest cursor state (ORDER BY updated_at DESC LIMIT 1)
  - [ ] `loadCursor()` — empty table → returns null (fresh start)
- [ ] **IMPLEMENT** extend `src/ingestion/cursor.ts` with DB operations
- [ ] **VERIFY** all tests green

---

## Phase 4: Integration — Pipeline

### Step 4.1: Pipeline Orchestration

> Async concurrency pool (p-limit), ties everything together

- [ ] **TEST** `tests/integration/pipeline.test.ts`
  - [ ] Ingests events from mock API → stores in real Postgres
  - [ ] Respects concurrency limit (starts at 5 slots)
  - [ ] Saves cursor checkpoint every batch
  - [ ] Resumes from checkpoint after simulated crash
  - [ ] Stops when `hasMore === false`
  - [ ] Handles 429 mid-ingestion → waits and continues
  - [ ] Handles stale cursor → resets and re-fetches
  - [ ] Progress callback fires with correct counts
- [ ] **IMPLEMENT** `src/ingestion/pipeline.ts`
- [ ] **VERIFY** all tests green

### Step 4.2: DB Integration

> Real Postgres read/write cycle

- [ ] **TEST** `tests/integration/db.test.ts`
  - [ ] Migrations create all tables in real Postgres
  - [ ] Writer inserts batch via COPY → staging → upsert flow
  - [ ] Duplicate insert → no error, count unchanged
  - [ ] Cursor save → cursor load roundtrip
  - [ ] COPY performance: 10k rows inserted < 1 second
- [ ] **IMPLEMENT** `src/db/client.ts` (pool setup with max: 15, idle: 30s, timeout: 5s)
- [ ] **VERIFY** all tests green

---

## Phase 5: Entrypoint + Docker

### Step 5.1: Main Entrypoint

- [ ] **IMPLEMENT** `src/index.ts`
  - [ ] Register `SIGTERM`/`SIGINT` handlers (graceful shutdown)
  - [ ] Load config
  - [ ] Init DB pool (max: 15 connections)
  - [ ] Run migrations
  - [ ] Load cursor state (resume or fresh start)
  - [ ] Start pipeline with hardcoded discovered params
  - [ ] Log final stats on completion
  - [ ] Print `"ingestion complete"` (required by `run-ingestion.sh`)
  - [ ] On SIGTERM: flush buffer → save cursor → close pool → exit

### Step 5.2: Dockerfile

- [ ] **CREATE** `packages/ingestion/Dockerfile`
  - [ ] Multi-stage build (builder + runtime)
  - [ ] `node:20-alpine` base
  - [ ] `npm ci` for deterministic installs
  - [ ] `npm run build` in builder stage
  - [ ] Copy only `dist/` + `node_modules/` to runtime

### Step 5.3: Docker Compose

- [ ] **UPDATE** `docker-compose.yml`
  - [ ] Add `ingestion` service
  - [ ] Container name: `assignment-ingestion`
  - [ ] Set environment: `DATABASE_URL`, `API_BASE_URL`, `API_KEY`
  - [ ] `depends_on: postgres` with `service_healthy` condition
  - [ ] Same `assignment-network`

### Step 5.4: End-to-End Verification

- [ ] `docker compose down -v` → clean slate
- [ ] `sh run-ingestion.sh` → completes without manual intervention
- [ ] Postgres has events in `ingested_events` table
- [ ] Logs show progress tracking (events/sec, ETA)
- [ ] Simulate crash (kill container mid-run) → restart → resumes from checkpoint
- [ ] No duplicate events after resume

---

## Phase 6: Submission

- [ ] Export all event IDs: `SELECT id FROM ingested_events` → `event_ids.txt`
- [ ] POST to `/api/v1/submissions` with event IDs + GitHub repo URL
- [ ] Verify submission response shows 3,000,000 events
- [ ] Push final code to GitHub
- [ ] Update `README.md` with:
  - [ ] How to run (`sh run-ingestion.sh`)
  - [ ] Architecture overview
  - [ ] API discoveries (endpoints, limits, cursor TTL, rate limits)
  - [ ] What you would improve with more time
