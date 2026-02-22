# API Discovery

## Endpoints

| Endpoint | Method | Rate Limit | Notes |
|----------|--------|-----------|-------|
| `/api/v1/events` | GET | 10/60s | Paginated. **Max `limit=5000`** |
| `/api/v1/events/:id` | GET | 10/60s | Single event lookup |
| `/api/v1/events/bulk` | POST | **20/60s** | Body: `{ids:[...]}`. 2x rate limit |
| `/api/v1/events/d4ta/x7k9/feed` | GET | **🚀 NONE** | Stream endpoint. Requires `X-Stream-Token` |
| `/internal/health` | GET | None | Returns DB + Redis status/latency |
| `/internal/stats` | GET | None | Counts, distributions, cache stats |
| `/internal/dashboard/stream-access` | POST | — | Returns stream token. **Dashboard-only (403 from server)** |

## 🚀 Stream Endpoint (High-Throughput Path)

**This is the fast path.** No rate limiting. Same pagination/cursor format.

### How to get a token
1. Open dashboard in browser with `?apiKey=<key>`
2. Run in console: `await (await fetch("/internal/dashboard/stream-access", {method:"POST", headers:{"X-API-Key":"<key>","Content-Type":"application/json"}})).json()`
3. Response: `{streamAccess: {endpoint, token, tokenHeader, expiresIn}}`

### Usage
```
GET /api/v1/events/d4ta/x7k9/feed?limit=5000&cursor=...
X-API-Key: <key>
X-Stream-Token: <token>
```

### Constraints
- Token TTL: **300 seconds** (5 min). Must refresh via dashboard before expiry.
- Expired token error: `{code: "INVALID_STREAM_TOKEN"}`
- 60 consecutive requests tested → **all 200, zero 429s**
- Same response shape: `{data, pagination, meta}`

### Throughput Comparison

| Path | Rate Limit | Events/req | Time for 3M |
|------|-----------|-----------|-------------|
| Standard `GET /events` | 10/60s | 5,000 | ~60 min |
| **Stream feed** | **None** | **5,000** | **~minutes** |

## Limit Testing

| Limit | Returned | Response Size |
|-------|----------|---------------|
| 100 | 100 | 35 KB |
| 500 | 500 | 173 KB |
| 1000 | 1000 | 347 KB |
| 5000 | 5000 | 1.73 MB |
| 10000 | **5000** | 1.73 MB |

**Max = 5000.** Requesting more silently caps at 5000.

## Query Params

| Param | Result |
|-------|--------|
| `sort=asc` | Ignored. Default order unchanged |
| `fields=id,type` | Ignored. Full schema returned |
| `format=csv` | Ignored. JSON returned |
| `since=<ms>` | Accepted by stream path only |
| `until=<ms>` | Accepted by stream path only |

## Rate Limits

- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Standard: **10 req/60s**
- Bulk: **20 req/60s**
- Reset value = seconds remaining (integer)
- Query param auth (`?apiKey=`, `?api_key=`) → **same pool as header auth, no advantage**

### 429 Response

```
HTTP/1.1 429 Too Many Requests
Retry-After: 28              ← seconds (integer)
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 28
```
```json
{"error":"Too Many Requests","code":"RATE_LIMIT_EXCEEDED","rateLimit":{"limit":10,"remaining":0,"reset":28}}
```

### Throughput Estimate

10 req/min × 5000 events/req = **~83K events/min** (standard path)

## Cursor

Base64-encoded JSON:
```json
{"id":"<last-event-uuid>","ts":1769541514766,"v":2,"exp":1771801075621}
```
- TTL: **~116 seconds** (via `pagination.cursorExpiresIn`)
- `v`: version, always `2`
- `exp`: absolute expiry (ms epoch)

## Response Shape

```
GET /api/v1/events?limit=1000
```
```json
{
  "data": [...],
  "pagination": { "limit": 1000, "hasMore": true, "nextCursor": "...", "cursorExpiresIn": 116 },
  "meta": { "total": 3000000, "returned": 1000, "requestId": "..." }
}
```

## ⚠️ Mixed Timestamps

Same response contains **both** formats:
- ISO 8601: `"2026-01-27T19:19:13.629Z"`
- Unix ms: `1769541612369`

Transformer must detect and normalize both.

## Caching

- `X-Cache: HIT|MISS`, `X-Cache-TTL: 30`
- Redis: 84.5% hit rate, 5 keys, 7.63M memory

## Event Schema

```json
{
  "id": "uuid",
  "sessionId": "uuid",
  "userId": "uuid",
  "type": "click|page_view|api_call|form_submit|scroll|purchase|error|video_play",
  "name": "event_xxx",
  "properties": { "page": "/home" },
  "timestamp": "ISO string OR unix ms",
  "session": { "id": "uuid", "deviceType": "mobile|tablet|desktop", "browser": "Chrome|Safari|Firefox|Edge" }
}
```

## Stats

- **3,000,000** events, **3,000** users, **60,000** sessions
- 8 event types, 3 device types (roughly equal split)

## Auth

- Header: `X-API-Key: <key>`
- Key valid **3 hours from first use**
