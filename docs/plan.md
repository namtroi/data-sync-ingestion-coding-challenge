# TDD Implementation Plan

## Overview

Build the ingestion system bottom-up using TDD. Write failing tests first, then implement to pass. Each step produces a working, tested module before moving to the next.

---

## Phase 0: Project Scaffolding

- [x] Init `packages/ingestion/` with `npm init`
- [x] Install deps: `typescript`, `vitest`, `axios`, `pg`, `pino`, `dotenv`
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

- [x] Open dashboard: `http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com`
- [x] Inspect Network tab — note all API calls the UI makes
- [x] Inspect JS source — look for hidden endpoints, params, or auth patterns
- [x] Document any undocumented routes discovered

### Step 1.2: API Endpoint Probing

- [x] Test `GET /api/v1/events` — confirm basic pagination works
- [x] Test different `limit` values: 100, 500, 1000, 5000, 10000
- [x] Record max accepted `limit` value → **5000**
- [x] Probe undocumented endpoints:
  - [x] `GET /api/v1/events/stream` — ❌ not a route (resolves to `:id` param)
  - [x] `POST /api/v1/events/bulk` — ✅ works, 20/60s rate limit
  - [x] `GET /api/v1/events/export` — ❌ not a route
  - [x] `/internal/health`, `/internal/stats` — ✅ work (no rate limit)
- [x] Test query params: `sort`, `fields`, `format`, `since`, `until` — all ignored by standard endpoint

### Step 1.3: Rate Limit & Header Analysis

- [x] Record rate limit headers: `X-RateLimit-Limit: 10`, `X-RateLimit-Remaining: N`, `X-RateLimit-Reset: <seconds>`
- [x] Test if header-based auth (`X-API-Key`) has different rate limits than query param auth → **No difference, same pool**
- [x] Trigger a 429 → `Retry-After: <seconds>` (integer, seconds format). Body: `{code:"RATE_LIMIT_EXCEEDED"}`
- [x] Estimate max sustainable requests per minute → **10 req/min × 5000 events = ~83K events/min**

### Step 1.4: Stream Endpoint Discovery

- [x] Discover `/internal/dashboard/stream-access` → returns `{endpoint, token, tokenHeader, expiresIn}`
- [x] Stream endpoint: `GET /api/v1/events/d4ta/x7k9/feed` with `X-Stream-Token` header
- [x] Confirm **no rate limit** (60 consecutive requests, all 200)
- [x] Token TTL: **300 seconds** (5 min)

### Step 1.5: Update Config

- [x] Update `src/config.ts` with discovered values:
  ```typescript
  api: {
    endpoint: '/events',
    maxLimit: 5000,
    rateLimitPerMinute: 10,
    cursorTTLSeconds: 116,
  }
  ```
- [x] Document all findings in `README.md` > API Discoveries section
- [x] Document all findings in `docs/discovery.md`

---

## Phase 2: Pure Logic — No I/O

### Step 2.1: Transformer

> Normalize mixed timestamps, map raw API fields → DB row format

- [x] **TEST** `tests/unit/transformer.test.ts`
  - [x] `normalizeTimestamp()` — ISO string → Date object
  - [x] `normalizeTimestamp()` — Unix epoch ms → Date object
  - [x] `normalizeTimestamp()` — invalid input → throws
  - [x] `transformEvent()` — raw API event → `{ id, event_type, timestamp, data }` row
  - [x] `transformEvent()` — missing `id` field → throws
  - [x] `transformEvents()` — batch of raw events → batch of rows
- [x] **IMPLEMENT** `src/ingestion/transformer.ts`
- [x] **VERIFY** all tests green

### Step 2.2: Cursor State

> Serialize/deserialize cursor checkpoint data

- [x] **TEST** `tests/unit/cursor.test.ts`
  - [x] `CursorState.create()` — creates initial state (null cursor, 0 events)
  - [x] `CursorState.fromRow()` — deserializes DB row → CursorState object
  - [x] `CursorState.toRow()` — serializes CursorState → DB row values
  - [x] `CursorState.update()` — updates cursor value + event count
- [x] **IMPLEMENT** `src/ingestion/cursor.ts`
- [x] **VERIFY** all tests green

### Step 2.3: Progress Tracker

> events/sec calculation, ETA estimation

- [x] **TEST** `tests/unit/progress.test.ts`
  - [x] `start()` — records start time
  - [x] `update(count)` — tracks total events ingested
  - [x] `getEventsPerSecond()` — calculates throughput
  - [x] `getETA(totalEvents)` — estimates remaining time
  - [x] `getSummary()` — returns formatted progress string
- [x] **IMPLEMENT** `src/utils/progress.ts`
- [x] **VERIFY** all tests green

---

## Phase 3: I/O with Mocks

### Step 3.1: API Client

> Axios instance with stream token support

- [x] **TEST** `tests/unit/apiClient.test.ts`
  - [x] Creates axios instance with correct base URL
  - [x] Attaches `X-API-Key` header to every request
  - [x] Attaches `X-Stream-Token` header when token is configured
  - [x] Timeout configured (10s)
- [x] **IMPLEMENT** `src/api/client.ts`
- [x] **VERIFY** all tests green

### Step 3.2: Fetcher

> Fetch single page from stream endpoint, parse response

- [x] **TEST** `tests/unit/fetcher.test.ts`
  - [x] `fetchPage(cursor?)` — returns `{ data, hasMore, nextCursor }`
  - [x] `fetchPage()` — no cursor → first page
  - [x] `fetchPage()` — with cursor → specific page
  - [x] `fetchPage()` — uses stream endpoint when token available
  - [x] `fetchPage()` — falls back to standard endpoint when no token
  - [x] `fetchPage()` — API returns 500 → retries with exponential backoff (max 3)
  - [x] `fetchPage()` — API returns 401/403 → throws auth error (no retry)
  - [x] `fetchPage()` — network timeout → retries up to 3 times
- [x] **IMPLEMENT** `src/api/fetcher.ts`
- [x] **VERIFY** all tests green

### Step 3.3: DB Writer (COPY + Staging + Upsert)

> Batch buffer + COPY → staging → INSERT ON CONFLICT workflow

- [x] **TEST** `tests/unit/writer.test.ts`
  - [x] `add(rows)` — buffers rows in memory
  - [x] `add(rows)` — auto-flushes when buffer reaches batch size (5000)
  - [x] `flush()` — COPY rows into `staging_events` table
  - [x] `flush()` — INSERT from `staging_events` into `ingested_events` ON CONFLICT DO NOTHING
  - [x] `flush()` — TRUNCATE `staging_events` after upsert
  - [x] `flush()` — empty buffer → no-op
  - [x] `close()` — flushes remaining + releases connection
- [x] **IMPLEMENT** `src/db/writer.ts`
- [x] **VERIFY** all tests green

### Step 3.4: DB Migrations

> Create tables on startup

- [x] **TEST** `tests/unit/migrations.test.ts`
  - [x] `runMigrations()` — creates `ingested_events`, `staging_events`, `cursor_state`
  - [x] Idempotent — running twice doesn't error
- [x] **IMPLEMENT** `src/db/migrations.ts`
- [x] **VERIFY** all tests green

### Step 3.5: Cursor Persistence

> Save/load cursor state to/from DB

- [x] **TEST** `tests/unit/cursorPersistence.test.ts`
  - [x] `saveCursor(state)` — inserts/updates cursor_state row
  - [x] `loadCursor()` — returns latest cursor state
  - [x] `loadCursor()` — empty table → returns null (fresh start)
- [x] **IMPLEMENT** extend `src/ingestion/cursor.ts` with DB operations
- [x] **VERIFY** all tests green

---

## Phase 4: Integration — Pipeline

### Step 4.1: Pipeline Orchestration

> Sequential fetch loop: fetch → transform → write → save cursor → repeat

- [ ] **TEST** `tests/integration/pipeline.test.ts`
  - [ ] Ingests events from mock API → stores in real Postgres
  - [ ] Saves cursor checkpoint every batch
  - [ ] Resumes from checkpoint after simulated crash
  - [ ] Stops when `hasMore === false`
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
- [ ] **IMPLEMENT** `src/db/client.ts` (pool setup with max: 10)
- [ ] **VERIFY** all tests green

---

## Phase 5: Entrypoint + Docker

### Step 5.1: Main Entrypoint

- [ ] **IMPLEMENT** `src/index.ts`
  - [ ] Register `SIGTERM`/`SIGINT` handlers (graceful shutdown)
  - [ ] Load config (including `STREAM_TOKEN` env var)
  - [ ] Init DB pool
  - [ ] Run migrations
  - [ ] Load cursor state (resume or fresh start)
  - [ ] Start pipeline loop
  - [ ] Log final stats on completion
  - [ ] Print `"ingestion complete"` (required by `run-ingestion.sh`)

### Step 5.2: Dockerfile

- [ ] **CREATE** `packages/ingestion/Dockerfile`
  - [ ] Multi-stage build (builder + runtime)
  - [ ] `node:20-alpine` base
  - [ ] `npm ci` → `npm run build` → copy `dist/` + `node_modules/`

### Step 5.3: Docker Compose

- [ ] **UPDATE** `docker-compose.yml`
  - [ ] Add `ingestion` service
  - [ ] Container name: `assignment-ingestion`
  - [ ] Set env: `DATABASE_URL`, `API_BASE_URL`, `TARGET_API_KEY`, `STREAM_TOKEN`
  - [ ] `depends_on: postgres` with `service_healthy` condition

### Step 5.4: End-to-End Verification

- [ ] `docker compose down -v` → clean slate
- [ ] `sh run-ingestion.sh` → completes without manual intervention
- [ ] Postgres has events in `ingested_events` table
- [ ] Logs show progress tracking (events/sec, ETA)
- [ ] Simulate crash (kill container) → restart → resumes from checkpoint
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
  - [ ] API discoveries
  - [ ] What you would improve with more time
