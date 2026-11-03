# agent.md — RailGrid: a production-grade, IRCTC-style train booking system

> Working name: **RailGrid**. Rename freely.
> You (the coding agent) are building this end to end: backend, workers, frontend, infra, tests, CI/CD and deployment.
> Read this entire file before writing code. Work phase by phase. Do not skip acceptance criteria.

---

## 0. Mission

Build a **portfolio-grade but genuinely production-shaped** train ticket booking platform that:

1. Lets users search trains, pick **specific seats for a specific journey segment**, pay (Razorpay **test mode**), and receive a ticket.
2. **Never double-books**, even under heavy concurrency, retries, crashes and duplicate webhooks.
3. Pulls **train schedules and live running status from an external API**, safely (cache, timeout, circuit breaker, fallback).
4. Has a **distinctive, memorable UI** (see section 9), not a generic template.
5. Is **deployed** on a public URL with CI/CD, monitoring and a load test proving zero double bookings.

This is a demo/portfolio system. It is **not affiliated with IRCTC or Indian Railways**. Never use their logos or trademarks. Never scrape IRCTC/NTES. Never use live payment keys.

---

## 1. Agent working agreement (follow strictly)

1. **Plan, then build.** At the start of each phase, write a short plan in `PROGRESS.md`. At the end, record what was done, decisions taken, and anything deferred.
2. **Small, meaningful commits** (Conventional Commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`). One concern per commit.
3. **Tests first for risky logic**: concurrency, idempotency, state machines, rate limiter, webhook handling. Write the failing test, then the code.
4. **The database is the source of truth.** Correctness must come from constraints and transactions, never from "the app checks first".
5. **Never invent external API response shapes.** Before coding the integration, open the provider's current docs (RailRadar: https://railradar.in/docs), call the real endpoint with `curl`, save sample responses as fixtures, and write zod schemas from the real data. Endpoints named in this file are starting points; verify them.
6. **Never commit secrets.** Use `.env.example` with placeholders. Add secret scanning (gitleaks) to CI.
7. **Run what you build.** After each phase, run the app, run the tests, and hit the endpoints. Do not report success on code you did not execute.
8. **No silent deviations.** If you must deviate from this file (library unavailable, API changed), note it in `PROGRESS.md` under "Deviations" with the reason.
9. **Keep it simple where it does not matter, rigorous where it does.** Spend effort on sections 5, 6, 7 and 8.
10. At the end of each phase, stop and print a summary: what works, how to run it, what is next.
11. **Neon is the selected hosted database.** Runtime uses Neon's pooled PostgreSQL URL; Prisma migrations use its direct URL. Keep local Postgres Compose as the offline development fallback. Never commit either URL or a Neon API token.

---

## 2. Tech stack (decided; do not re-litigate)

| Layer                        | Choice                                                                                                            | Notes                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Language                     | **TypeScript** everywhere                                                                                         | strict mode on                                                                      |
| Monorepo                     | **pnpm workspaces** + Turborepo                                                                                   |                                                                                     |
| Frontend                     | **Next.js (App Router)**, Tailwind CSS, Radix UI primitives, Framer Motion, TanStack Query, Zustand               |                                                                                     |
| API                          | **Fastify** (Node 20+)                                                                                            | zod validation via `fastify-type-provider-zod`                                      |
| ORM / migrations             | **Prisma** for schema + simple queries; **raw SQL migrations** for constraints; `$queryRaw` for critical sections | Prisma cannot express exclusion constraints, so add them in hand-written migrations |
| Database                     | **Neon PostgreSQL** (PostgreSQL 16 compatible) with `btree_gist`; local PostgreSQL 16 for offline development     |                                                                                     |
| Cache / rate limit / pub-sub | **Redis 7**                                                                                                       | not the lock authority (see 6.2)                                                    |
| Queue / scheduler            | **BullMQ**                                                                                                        | separate worker process                                                             |
| Realtime                     | **WebSocket** (`ws` or Socket.IO with Redis adapter)                                                              | seat-map updates                                                                    |
| Payments                     | **Razorpay** (test mode)                                                                                          | Stripe optional later                                                               |
| Email                        | **Resend** (or SES)                                                                                               | transactional only                                                                  |
| Bot protection               | **Cloudflare Turnstile**                                                                                          | test keys in dev                                                                    |
| Password hashing             | **argon2id**                                                                                                      |                                                                                     |
| Validation                   | **zod**                                                                                                           | shared schemas in `packages/shared`                                                 |
| Observability                | pino logs, OpenTelemetry traces, Prometheus metrics, Sentry                                                       |                                                                                     |
| Testing                      | Vitest, Testcontainers (Postgres + Redis), Playwright, k6, axe                                                    |                                                                                     |
| CI/CD                        | GitHub Actions                                                                                                    |                                                                                     |
| Containers                   | Docker, docker-compose for local                                                                                  |                                                                                     |

### Repo layout

```
railgrid/
├─ apps/
│  ├─ web/                 # Next.js frontend
│  ├─ api/                 # Fastify HTTP + WebSocket server (stateless)
│  └─ worker/              # BullMQ workers + schedulers
├─ packages/
│  ├─ shared/              # zod schemas, types, constants, state machines
│  └─ db/                  # prisma schema, raw SQL migrations, seed scripts
├─ infra/
│  ├─ docker/              # Dockerfiles
│  ├─ docker-compose.yml
│  └─ terraform/           # optional stretch: AWS reference stack
├─ tests/
│  ├─ load/                # k6 scripts
│  └─ chaos/               # crash/recovery scripts
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ DESIGN.md            # Problem -> Solution -> Trade-off register
│  ├─ RUNBOOK.md
│  └─ openapi.yaml
├─ .github/workflows/
├─ PROGRESS.md
├─ .env.example
└─ agent.md
```

---

## 3. High-level architecture (the real-life version)

```
                         Users (mobile-first, India)
                                   │
                    ┌──────────────▼──────────────┐
                    │  Cloudflare: DNS, CDN, WAF,  │
                    │  DDoS, edge rate limiting,   │
                    │  Turnstile                   │
                    └───────┬───────────────┬──────┘
                            │               │
              static + SSR  │               │ /api, /ws
                ┌───────────▼───┐     ┌─────▼─────────────────┐
                │ Next.js (web) │     │ Load balancer / proxy │
                │ Vercel / CDN  │     └─────┬─────────────────┘
                └───────────────┘           │
                                  ┌─────────▼──────────┐
                                  │ API replicas (N)    │  stateless, autoscaled
                                  │ Fastify + WebSocket │  /health /ready /metrics
                                  └──┬─────┬─────────┬──┘
                                     │     │         │
                 ┌───────────────────▼┐  ┌─▼───────┐ │
                 │ PgBouncer (pooling)│  │ Redis   │ │
                 └─────────┬──────────┘  │ cache   │ │
                           │             │ rate-lim│ │
                 ┌─────────▼──────────┐  │ pub/sub │ │
                 │ PostgreSQL primary │  │ queue   │ │
                 │ (source of truth)  │  └────▲────┘ │
                 └─────────┬──────────┘       │      │
                           │ replication      │      │
                 ┌─────────▼──────────┐  ┌────┴──────▼───────────┐
                 │ Read replica       │  │ Worker pool (M)       │
                 │ (search, reports)  │  │  - hold expiry sweeper│
                 └────────────────────┘  │  - payment reconcile  │
                                         │  - outbox publisher   │
                                         │  - email / ticket PDF │
                                         │  - external data sync │
                                         └────┬──────────────────┘
                                              │
        ┌─────────────────────┬───────────────┼───────────────────┐
        ▼                     ▼               ▼                   ▼
   Razorpay API         Train data API     Email provider      Sentry / OTel /
   + webhooks           (RailRadar)        (Resend/SES)        Prometheus/Grafana
```

### Architectural principles

1. **Stateless API.** Any replica can serve any request. State lives in Postgres and Redis. WebSockets fan out through Redis pub/sub.
2. **Postgres is the authority** for seat inventory, bookings, payments. Constraints reject invalid states even if application code is buggy. Neon is the selected hosted provider.
3. **Redis is an accelerator, not an authority.** If Redis is wiped, the system must still be correct (just slower and temporarily without rate-limit history).
4. **Everything asynchronous goes through the outbox.** No "commit DB, then send email" dual writes.
5. **Webhooks are the source of truth for payment outcome.** The browser redirect is only a UX hint.
6. **Every mutating endpoint is idempotent** and every state change goes through a state machine.
7. **External APIs are untrusted and unreliable.** Wrap them in timeout, retry, circuit breaker, cache and fallback.
8. **Everything is observable.** Request IDs flow through logs, traces and queue jobs.

### Real-life realism notes (put these in `docs/ARCHITECTURE.md`)

- Real IRCTC peak load is dominated by a 10:00 / 11:00 AM burst (Tatkal). The design answers this with a **virtual waiting room**, per-user and per-IP limits, cached read paths and atomic DB writes. State plainly which parts you load-tested and which are design-only.
- Partition-ready: seat inventory is keyed by `(run_id, seat_id)`, so hot trains/dates can later be sharded or partitioned by `journey_date`.
- Deploy API and workers as **long-running containers**, not serverless functions (WebSockets, connection pooling, BullMQ).
- Use a region near users (Mumbai / Singapore where available) for API, DB and Redis together; cross-region chatter kills latency.

---

## 4. Domain model

### 4.1 Concepts

- **Station**, **Train** (number, name, type), **TrainStop** (train, station, `stop_idx`, arrival, departure, `day_offset`, distance_km).
  `stop_idx` is a 0-based ordinal along the route. Overnight trains use `day_offset`.
- **Run**: one train on one `journey_date` (the unit of inventory). `runs(train_id, journey_date)` unique.
- **Coach / Seat**: classes `SL`, `3A`, `2A`, `CC` (generate approximate layouts; document that they are simplified). Seats have `coach`, `number`, `berth_type` (`LB`, `MB`, `UB`, `SL`, `SU`, `WINDOW`, `AISLE`, ...).
- **Segment booking**: a booking occupies a seat for `[from_idx, to_idx)` (half-open). Delhi(0)→Kanpur(3) and Kanpur(3)→Lucknow(5) **can share a seat**; Delhi(0)→Lucknow(5) cannot overlap either.
- **Booking** (PNR), **BookingPassenger**, **SeatAllocation**, **Payment**, **Refund**, **WaitlistEntry**.
- Times: store UTC `timestamptz`; journey dates as `DATE` interpreted in `Asia/Kolkata`; render in IST.
- Config (env, not hardcoded): advance booking window (default 60 days), hold TTL (default 10 min), payment extension (default +5 min, once), Tatkal window start times.

### 4.2 Core tables (essentials)

Create these via Prisma + raw SQL. Add `created_at`, `updated_at` everywhere. Use UUIDs for public identifiers (bookings, payments), never sequential IDs.

```
users(id, email unique, password_hash, email_verified_at, role, created_at)
refresh_tokens(id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by, ip, user_agent)
stations(code pk, name, city, lat, lng)
trains(number pk, name, type)
train_stops(train_number, stop_idx, station_code, arrival, departure, day_offset, distance_km,
            pk(train_number, stop_idx))
runs(id, train_number, journey_date, status, unique(train_number, journey_date))
seats(id, train_number, class_code, coach, seat_no, berth_type, unique(train_number, coach, seat_no))
fare_rules(class_code, per_km_paise, base_paise, reservation_fee_paise, superfast_fee_paise)
bookings(id uuid, pnr unique, user_id, run_id, from_idx, to_idx, class_code,
         status, total_paise, hold_expires_at, created_at)
booking_passengers(id, booking_id, name, age, gender, seat_allocation_id, status)
seat_allocations(...)   -- see 4.3, the heart of the system
payments(id uuid, booking_id, gateway, gateway_order_id unique, gateway_payment_id unique nullable,
         amount_paise, currency, status, failure_reason, created_at)
payment_events(id, gateway_event_id unique, type, payload jsonb, processed_at)  -- webhook dedupe
refunds(id, payment_id, amount_paise, status, gateway_refund_id unique nullable, reason)
idempotency_keys(key, user_id, endpoint, request_hash, status, response_code, response_body jsonb,
                 locked_at, created_at, pk(user_id, key))
outbox_events(id bigserial, type, aggregate_id, payload jsonb, created_at, published_at)
waitlist_entries(id, run_id, class_code, booking_id, position_seq, status)
audit_log(id bigserial, actor, entity, entity_id, from_state, to_state, reason, request_id, created_at)
api_cache_meta(...)     -- optional bookkeeping for external API snapshots
```

### 4.3 The seat allocation table (non-negotiable)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE seat_allocations (
  id               BIGSERIAL PRIMARY KEY,
  run_id           BIGINT      NOT NULL REFERENCES runs(id),
  seat_id          BIGINT      NOT NULL REFERENCES seats(id),
  booking_id       UUID        NOT NULL REFERENCES bookings(id),
  from_idx         SMALLINT    NOT NULL,
  to_idx           SMALLINT    NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('HELD','CONFIRMED','RELEASED','EXPIRED')),
  hold_expires_at  TIMESTAMPTZ,
  CHECK (from_idx < to_idx),
  CHECK (status <> 'HELD' OR hold_expires_at IS NOT NULL),
  EXCLUDE USING gist (
    run_id WITH =,
    seat_id WITH =,
    int4range(from_idx, to_idx) WITH &&
  ) WHERE (status IN ('HELD','CONFIRMED'))
);
CREATE INDEX ON seat_allocations (booking_id);
CREATE INDEX ON seat_allocations (status, hold_expires_at) WHERE status = 'HELD';
```

Even if every line of application code is wrong, Postgres rejects an overlapping active allocation (error `23P01`, `exclusion_violation`). Map it to HTTP 409 `SEAT_TAKEN`.

---

## 5. Booking engine (the core)

### 5.1 State machines (implement once in `packages/shared`, reuse everywhere)

```
Booking:  CREATED → SEATS_HELD → PAYMENT_PENDING → CONFIRMED
                         │              │              └→ CANCELLED → (refund flow)
                         ├→ EXPIRED     ├→ FAILED
                         └→ CANCELLED   └→ EXPIRED → (late payment → CONFIRMED or REFUND_DUE)
Payment:  CREATED → CAPTURED | FAILED ;  CAPTURED → REFUND_PENDING → REFUNDED | REFUND_FAILED
Seat alloc: HELD → CONFIRMED | RELEASED | EXPIRED
```

- A single `transition(entity, from, to, reason)` function validates legal transitions, writes `audit_log`, and runs **inside the caller's transaction**.
- Illegal or repeated transitions are no-ops when idempotent (already in target state) and errors otherwise.

### 5.2 Hold seats (`POST /v1/bookings`)

Requires header `Idempotency-Key`. One DB transaction, `READ COMMITTED`:

1. Validate server-side: run exists, not departed, within booking window, passengers count (1–6), ages, from/to indices valid, user does not already hold an active booking for the same run (limit concurrent holds per user).
2. **Expire stale holds on candidate seats first** (so an expired-but-unswept hold never blocks a buyer):
   ```sql
   UPDATE seat_allocations SET status='EXPIRED'
   WHERE run_id=$1 AND status='HELD' AND hold_expires_at < now();
   ```
3. Pick seats, locking rows but skipping contended ones:
   ```sql
   SELECT s.id FROM seats s
   WHERE s.train_number = $1 AND s.class_code = $2
     AND NOT EXISTS (
       SELECT 1 FROM seat_allocations a
       WHERE a.run_id = $3 AND a.seat_id = s.id
         AND a.status IN ('HELD','CONFIRMED')
         AND int4range(a.from_idx, a.to_idx) && int4range($4, $5)
     )
   ORDER BY s.id
   LIMIT $6
   FOR UPDATE OF s SKIP LOCKED;
   ```
   If the user picked specific seats, lock exactly those (`WHERE s.id = ANY($ids) ORDER BY s.id FOR UPDATE`) and fail with `SEAT_TAKEN` listing which ones are gone.
4. Insert `seat_allocations` as `HELD` with `hold_expires_at = now() + TTL` (DB time only, never app clock).
5. Insert booking `SEATS_HELD`, passengers, outbox event `booking.held`.
6. Compute fare **server-side** from `fare_rules`. Ignore any client-sent amount.
7. Commit. Publish seat events to Redis channel `run:{id}` (best effort, after commit).

Error handling:

- `23P01` exclusion violation → retry (max 3) with a fresh seat selection when auto-picking; otherwise 409.
- `40P01` deadlock / `40001` serialization → retry with jittered backoff.
- Not enough seats → 409 `INSUFFICIENT_SEATS` (offer waitlist if enabled).

### 5.3 Why this is correct (document in `DESIGN.md`)

- `FOR UPDATE SKIP LOCKED` lets concurrent requests take **different** seats instead of queueing.
- Consistent ordering (`ORDER BY s.id`) removes deadlocks when users pick specific seats.
- The exclusion constraint is the final guard against overlapping segments and bugs.
- Check and write happen in one transaction; there is no "read then write in app code".

### 5.4 Redis usage in the booking path (optional accelerators only)

- Cache availability **counts** per `(run, class)` for ~5 s for the search UI. Display data only; the hold transaction is always authoritative.
- Waiting room admission tokens (see 8.3).
- Do **not** use Redis locks to decide seat ownership. Implement a token-checked Redis lock helper (`SET key token NX PX ttl` + Lua release `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`) and use it for **single-flight cache refill** of external API data (section 7). Document that this is exactly where a Redis lock is appropriate.

### 5.5 Pricing

`fare = base + per_km * distance(from_idx..to_idx) + reservation_fee + (superfast_fee if applicable)`, in **paise** (integers). Never floats. Add optional Tatkal surcharge flag. Unit-test boundaries.

### 5.6 PNR

10-digit random numeric PNR (not sequential, to prevent enumeration), unique index, retry on collision.

---

## 6. Payments, idempotency, webhooks, reconciliation

### 6.1 Flow

1. `POST /v1/bookings/:id/pay` (idempotent): booking must be `SEATS_HELD` and not expired. Extend hold once (`hold_expires_at = max(current, now()+extension)`), set `PAYMENT_PENDING`, create Razorpay order (`amount` = server fare in paise, `receipt` = booking id), store `payments` row `CREATED`. Return `order_id` and public key id.
2. Frontend opens Razorpay Checkout. On success it receives `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`.
3. `POST /v1/payments/verify` (optimistic UX path): verify `HMAC_SHA256(order_id + "|" + payment_id, key_secret)` with timing-safe compare. This may mark the payment captured and confirm, but the webhook must reach the same result safely.
4. **Webhook `POST /v1/webhooks/razorpay`** (source of truth): use the **raw body** to verify `X-Razorpay-Signature` with the webhook secret. Dedupe on the event id header (verify the exact header name in current Razorpay docs) via `payment_events.gateway_event_id UNIQUE`. Always return 200 quickly after durable write; process in a transaction.
5. **Confirm transaction** (shared by verify path, webhook, and reconciler):
   ```
   BEGIN
     SELECT booking FOR UPDATE
     if booking.status == CONFIRMED → return (idempotent)
     if booking.status in (SEATS_HELD, PAYMENT_PENDING):
         verify gateway amount == booking.total_paise
         mark allocations CONFIRMED (hold_expires_at = NULL), booking CONFIRMED, payment CAPTURED
     if booking.status == EXPIRED (late payment):
         try to re-acquire the same seats (same allocation query);
         success → confirm; failure → payment CAPTURED + enqueue REFUND, booking REFUND_DUE
     insert outbox 'booking.confirmed'
   COMMIT
   ```
6. Outbox worker sends email + generates ticket PDF with QR (QR encodes PNR + signed token).

### 6.2 Idempotency middleware (applies to all mutating booking/payment/cancel endpoints)

- Header `Idempotency-Key` (UUID v4) is **required**. Scope keys by `(user_id, key)`.
- Algorithm:
  1. `INSERT ... ON CONFLICT DO NOTHING` a row with `status='IN_PROGRESS'`, `request_hash = sha256(method+path+canonical body)`, `locked_at = now()`.
  2. Inserted → run handler, then store `response_code`, `response_body`, set `COMPLETED`.
  3. Existing & hash differs → `422 IDEMPOTENCY_KEY_REUSED`.
  4. Existing & `IN_PROGRESS` & `locked_at` recent → `409` with `Retry-After`.
  5. Existing & `COMPLETED` → replay stored response with header `Idempotent-Replayed: true`.
  6. `IN_PROGRESS` older than 60 s → treat as crashed, allow takeover.
- Cleanup job deletes keys older than 48 h.

### 6.3 Reconciliation worker (runs every 2 minutes)

For payments `CREATED` older than 3 minutes (or bookings `PAYMENT_PENDING` past expiry): fetch the order/payment status from Razorpay, then run the same confirm transaction or mark failed/expired. This fixes "money deducted but booking missing" even if a webhook was lost. Alert if a payment stays unresolved > 15 minutes.

### 6.4 Refunds

Own table + state machine. Refund calls carry an idempotency key. Retry with backoff. Handle partial refunds (cancellation fee rules in `fare_rules`). Never refund the same payment twice (unique on gateway refund id; check remaining refundable amount in-transaction).

### 6.5 Security rules for payments

- Never trust amounts, prices or status from the client.
- Do not store card data. Razorpay Checkout keeps you out of PCI scope.
- Webhook endpoint is excluded from user rate limiting but protected by signature verification (and optional IP allowlist).

---

## 7. External data integration (train timings and live status)

### 7.1 Provider abstraction

```ts
interface TrainDataProvider {
  getTrain(number: string): Promise<TrainSchedule>;
  getLiveStatus(number: string, date?: string): Promise<LiveStatus>;
  getTrainsBetween(from: string, to: string): Promise<TrainSummary[]>;
  getStationBoard(code: string): Promise<StationBoardEntry[]>;
}
```

Implementations:

- `RailRadarProvider` (real). Base URL `https://api.railradar.in/v1`, `Authorization: Bearer <key>`. Verified endpoints: `/trains/{number}`, `/trains/{number}/live`, `/trains/between/{from}/{to}`, and `/stations/{code}/live`. Successful responses use `{ success, data, meta }`; validate and normalize `data` before returning it. See https://railradar.in/docs. The current free Sandbox tier is 100 requests per billing month and 10 requests per minute; guard conservatively with a rolling 30-day budget and cache-only behavior at 80%.
- `FixtureProvider` (dev/test/CI): serves saved real responses. CI never calls the network.
- Selected by env `TRAIN_DATA_PROVIDER=railradar|fixture`.

### 7.2 Strategy: seed static, fetch live sparingly

- **Static data** (stations, trains, stops, distances): import once for **15–25 popular trains** (Rajdhani, Shatabdi, Vande Bharat, a few Express/Mail) with `pnpm db:import-trains`. The booking engine runs on **your own tables**, never on live API calls. Generate seats and `runs` for the next N days with `pnpm db:seed-runs`.
- **Live status**: fetched on demand for the confirmation page, "My trips", and the route ribbon.
- Refresh static data weekly via a worker job; diff and log changes.

### 7.3 Resilience (all mandatory)

| Concern                | Implementation                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Timeout                | 3 s hard timeout (AbortController)                                                                                |
| Retry                  | up to 2 retries, GET only, exponential backoff with jitter; never retry on 4xx except 429 (respect `Retry-After`) |
| Circuit breaker        | open after repeated failures (e.g. `opossum`), half-open probes, metrics on state                                 |
| Cache                  | Redis: live status TTL 60 s, schedules TTL 24 h; key includes provider + params                                   |
| Stale-while-revalidate | serve stale value immediately, refresh in background                                                              |
| Single-flight          | token-checked Redis lock so only one request refreshes a cold key (prevents cache stampede)                       |
| Quota guard            | Redis daily counter; at 80% of budget, serve cache only; at 100%, hard stop with "live data unavailable"          |
| Validation             | zod schema on every response; reject and log drift; never pass raw upstream JSON to the client                    |
| Fallback               | last known good value with `stale: true` and `fetched_at`; UI shows a calm "last updated 4 min ago" state         |
| Secrets                | API key only server-side; the browser never calls the provider                                                    |
| Observability          | metrics: requests, latency, errors, cache hit ratio, breaker state, quota used                                    |

### 7.4 Public endpoints exposed to the frontend

`GET /v1/trains/:number/live` returns `{ delayMinutes, currentStation, nextStation, updatedAt, stale }`.
Add a small attribution line in the UI: "Live data via third-party provider. Demo only."

---

## 8. Authentication, rate limiting, and abuse protection

### 8.1 Auth design

- Register, verify email, login, refresh, logout, forgot/reset password.
- **argon2id** hashing (sane memory/time params; benchmark and document).
- **Access token**: JWT, 15 min, in memory on the client. **Refresh token**: opaque random, stored hashed in DB, 7–30 days, **rotated on every use** in an `httpOnly; Secure; SameSite=Lax` cookie. **Reuse detection**: if a rotated token is reused, revoke the whole `family_id`.
- Serve web at `app.example.com` and API at `api.example.com` (same site) so `SameSite=Lax` works. Add CSRF protection (custom header + origin check) for cookie-authenticated endpoints.
- Generic error messages ("Invalid email or password"), constant-ish response time to avoid account enumeration.
- Ownership checks on **every** resource (prevent IDOR). Role-based guard for admin routes.
- `helmet`, strict CORS allowlist, request size limits, zod validation on every input, parameterized queries only.

### 8.2 Rate limiter on authentication endpoints (required)

Implement a **Redis sliding-window limiter** as a reusable Fastify plugin, applied with different policies per route.

**Policies (defaults, configurable by env):**

| Endpoint                     | Key(s)                                    | Limit                                            |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------ |
| `POST /auth/login`           | `ip` and `sha256(email)` (both must pass) | 5 / 15 min per email+IP pair; 20 / 15 min per IP |
| `POST /auth/register`        | `ip`                                      | 3 / hour                                         |
| `POST /auth/forgot-password` | `ip` and `email`                          | 3 / hour each                                    |
| `POST /auth/refresh`         | `user/family` and `ip`                    | 30 / min                                         |
| `POST /auth/verify-email`    | `ip`                                      | 10 / hour                                        |
| Global (all other routes)    | `user_id` or `ip`                         | 120 / min                                        |
| `POST /bookings`             | `user_id`                                 | 10 / min                                         |

**Behavior:**

- On limit: `429` with `Retry-After`, plus `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers and a stable JSON error code.
- **Progressive friction on login**: after 3 failed attempts for an email, require a Turnstile token; after 10 failures, lock that email for 15 min with exponential backoff (cap 1 h). Notify the user by email on lockout. Do not reveal whether the account exists.
- **Real client IP**: configure trusted proxies correctly (behind Cloudflare use the Cloudflare-provided header only when the request really comes from Cloudflare). Test that spoofing `X-Forwarded-For` does not bypass limits.
- **Failure mode**: if Redis is unreachable, fall back to a stricter in-process limiter and emit an alert. Never silently disable the limiter.
- Hash identifiers (emails) in Redis keys; do not store raw emails there.
- Edge layer: also configure a Cloudflare rate-limiting rule on `/auth/*` as defense in depth (document it in the runbook).

**Atomic Lua script (single round trip):**

```lua
-- KEYS[1] = rate limit key
-- ARGV[1] = window_ms, ARGV[2] = limit, ARGV[3] = unique member id
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])

if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry_ms = tonumber(oldest[2]) + window - now
  return {0, count, retry_ms}
end

redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1, 0}
```

**Required tests:** limit enforced; window slides; two concurrent requests cannot both take the last slot; per-email and per-IP independence; lockout and backoff; spoofed header ignored; Redis-down fallback; headers correct.

### 8.3 Tatkal-style burst protection (virtual waiting room)

- Configurable "flash window" per train/class (e.g. opens at a set time).
- Users join a queue (`ZADD wr:{run}` by arrival time) and poll/WebSocket for position. A worker admits N users per second by issuing a short-lived signed **admission token** (JWT, 2–5 min). `POST /bookings` for flash-window runs requires a valid token.
- Enforce per-account booking-per-day limits, CAPTCHA (Turnstile) before joining, and per-IP limits.

---

## 9. Frontend: the UI must be unique

### 9.1 Design concept: "The Departure Board meets the Ticket Stub"

Heritage Indian railway signage × modern, tactile interface. Avoid generic SaaS look: no default shadcn gray cards on white, no purple gradients, no stock illustrations.

**Signature elements (build all):**

1. **Split-flap departure board** for search results and live status. Times and platform numbers flip with 3D CSS split-flap animation (staggered per character). Respect `prefers-reduced-motion` (fade instead).
2. **Journey Ribbon**: the route drawn as a metro-style line with station dots. The user **drags two handles** to choose boarding and destination stations. This directly drives `from_idx/to_idx`. A small train marker sits on the line showing live position and delay. Delay is shown as a pill (`On time`, `+12 min`).
3. **Segment-aware coach map**: a top-down coach cutaway with berth glyphs (LB/MB/UB/SL/SU). Each seat shows a **tiny segment bar** of where along the route it is already occupied. Seats unavailable for _your_ segment are dimmed with a pattern (not only color). Seats that are free for you but taken elsewhere on the route show a subtle "reusable berth" hint. This makes the backend's segment logic visible and impressive.
4. **Ticket stub confirmation**: the final ticket has perforated edges, a QR code, and a tear animation on reveal. Downloadable PDF and add-to-wallet-style image.
5. **Hold timer as a burning perforation**: the countdown eats along a perforated line; last 60 s switches to urgent styling and aria-live announcements.
6. **Live seat updates**: when another user locks a seat, it animates to "held" in real time; if the user's chosen seat is lost, show a friendly swap suggestion panel (nearest equivalent berths).

### 9.2 Design tokens

```
Ink (bg dark)      #0B1220     Paper (bg light)   #F5F0E6
Signal Amber       #FFB400     Rail Blue          #1F4FFF
Signal Green       #2FBF71     Signal Red         #E5484D
Chalk text         #E8ECF4     Steel muted        #8A94A8
```

- Dark mode default (board feel), light mode "paper ticket". Both must pass WCAG AA contrast.
- Fonts via `next/font` (self-hosted): display **Barlow Condensed** (signage feel), UI **Instrument Sans**, times/PNR **JetBrains Mono**. Provide system fallbacks.
- Radius small and crisp (2–6 px), 1 px hairlines, subtle paper grain on light mode only.
- Motion: Framer Motion springs, 150–300 ms for UI, longer only for the ticket reveal. All animation honors reduced motion.

### 9.3 Pages and flows

- `/` Search: from/to autocomplete (station code + name), date strip, quota/class chips. Hero is a live-looking departure board.
- `/trains` Results as board rows: train, times, duration, class availability chips (cached counts), live delay pill.
- `/trains/[number]` Journey Ribbon, schedule, live status, class tabs.
- `/book/[runId]/seats` Segment-aware coach map, fare summary, hold timer begins after selection.
- `/book/[bookingId]/passengers` Passenger form (validation, autofill from saved passengers).
- `/book/[bookingId]/pay` Razorpay Checkout (test mode), clear states: processing, success, failed, pending-confirmation (webhook not yet received: poll with backoff, never double-charge).
- `/tickets/[pnr]` Ticket stub, live status, cancel flow.
- `/account/bookings` History with filters; installable PWA with **offline access to confirmed tickets** (service worker cache).
- `/auth/*` Login/register/reset with rate-limit and lockout messaging that is helpful, not scary (show countdown from `Retry-After`).
- `/admin` Sales, active holds, stuck payments, webhook failures, refund queue, concurrency/health metrics.
- Status page (`/status`): API, DB, Redis, external provider (breaker state).

### 9.4 UX and quality requirements

- **Mobile-first**; most users are on mid-range Android over 4G. Targets: LCP < 2.5 s, CLS < 0.1, INP < 200 ms on throttled mobile. Enforce with Lighthouse CI budgets.
- Optimistic UI only where safe. Never show "Booked" until the server says `CONFIRMED`.
- Every error state designed: sold out, seat just taken, payment pending, API down, rate-limited, offline.
- Skeleton loaders shaped like board rows and coach maps.
- Accessibility: full keyboard seat selection (arrow keys across the coach grid), ARIA labels (`Coach B2, seat 14, lower berth, available for your journey`), focus management, color never the only signal, axe checks in Playwright.
- Optional stretch: English/Hindi toggle with `next-intl`.
- State: TanStack Query for server state; Zustand only for the transient selection state. Generate API types from `packages/shared` zod schemas.

---

## 10. Realtime

- WebSocket endpoint authenticates via short-lived token. Clients subscribe to `run:{id}`.
- Events: `seat.held`, `seat.released`, `seat.booked`, `availability.updated`. Payloads are minimal (ids and segment ranges only).
- API publishes after commit to Redis pub/sub; every API replica forwards to its sockets.
- Heartbeats, reconnect with backoff, and **full resync on reconnect** (events are hints; REST is truth). Limit connections per user and subscriptions per socket.

---

## 11. Workers and scheduled jobs (BullMQ)

| Job                             | Schedule                       | Purpose                                                                                                       |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `expire-holds`                  | every 30 s                     | mark `HELD` past `hold_expires_at` as `EXPIRED`, booking `EXPIRED`, publish `seat.released`                   |
| `reconcile-payments`            | every 2 min                    | resolve stuck `CREATED` / `PAYMENT_PENDING` (6.3)                                                             |
| `outbox-publisher`              | continuous (poll 1 s)          | `SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`, enqueue, mark published |
| `send-email`, `generate-ticket` | on event                       | idempotent consumers keyed by event id                                                                        |
| `process-refund`                | on event                       | refund state machine with retries                                                                             |
| `promote-waitlist`              | on cancellation                | in-transaction promotion (see 12)                                                                             |
| `sync-train-data`               | weekly                         | refresh static schedules, log diffs                                                                           |
| `admit-waiting-room`            | every 1 s during flash windows | admit N users                                                                                                 |
| `cleanup`                       | hourly                         | purge old idempotency keys, revoked tokens                                                                    |

All jobs idempotent, retried with backoff, dead-lettered after max attempts, with metrics and alerts. Workers handle `SIGTERM` gracefully (finish in-flight jobs).

---

## 12. Cancellation, waitlist, refunds

- `POST /bookings/:id/cancel` (idempotent): in **one transaction** set booking `CANCELLED`, allocations `RELEASED`, compute refund per `fare_rules`, create refund record, outbox events, then **promote the next waitlist entry** (`ORDER BY position_seq FOR UPDATE SKIP LOCKED`) by running the normal allocation for the freed seats.
- Double-cancel is a no-op (state machine + idempotency).
- Waitlist (Phase 7, simplified): if no seats, user may join waitlist for a class; payment is captured at booking; if not confirmed by a configurable cutoff before departure, auto-refund. Positions come from a per-run/class sequence.
- Block cancellation after departure; enforce server-side.

---

## 13. API surface (document in `docs/openapi.yaml`)

```
POST   /v1/auth/register | login | refresh | logout | forgot-password | reset-password | verify-email
GET    /v1/stations?q=
GET    /v1/trains/search?from=&to=&date=
GET    /v1/trains/:number
GET    /v1/trains/:number/live
GET    /v1/runs/:id/availability?from=&to=&class=
GET    /v1/runs/:id/seatmap?from=&to=&class=
POST   /v1/waiting-room/join        GET /v1/waiting-room/status
POST   /v1/bookings                 (Idempotency-Key)
POST   /v1/bookings/:id/passengers
POST   /v1/bookings/:id/pay         (Idempotency-Key)
POST   /v1/payments/verify          (Idempotency-Key)
POST   /v1/webhooks/razorpay        (signature-verified, raw body)
GET    /v1/bookings                 GET /v1/bookings/:id
POST   /v1/bookings/:id/cancel      (Idempotency-Key)
GET    /v1/tickets/:pnr/pdf
GET    /v1/admin/metrics | /v1/admin/payments/stuck | /v1/admin/webhooks/failed
GET    /health  /ready  /metrics
WS     /v1/ws
```

Consistent error format: `{ "error": { "code": "SEAT_TAKEN", "message": "...", "requestId": "..." } }`. Stable error codes documented.

---

## 14. Security checklist

- Argon2id; refresh rotation + reuse detection; JWT secrets rotated via env.
- Ownership checks on all booking/ticket/payment reads and writes (test IDOR explicitly).
- Webhook signature verification on raw body; timing-safe comparisons everywhere.
- Server-side recomputation of every price and date rule.
- Helmet, CORS allowlist, CSRF defense, input size limits, zod on all inputs, parameterized SQL.
- Logs redact tokens, passwords, emails (mask), payment ids partially.
- Dependency audit + gitleaks in CI; Dependabot enabled.
- Least-privilege DB roles (app role cannot DDL; migration role separate).
- Admin routes require role and are rate limited; consider 2FA stretch.
- No PII beyond what is needed; document data retention.

---

## 15. Observability and operations

- **Logging**: pino JSON with `requestId`, `userId`, `bookingId` correlation; propagate into queue jobs.
- **Tracing**: OpenTelemetry for HTTP, DB, Redis, outbound calls.
- **Metrics (Prometheus)**: `booking_attempts_total{result}`, `double_booking_prevented_total`, `holds_active`, `holds_expired_total`, `payments_pending_age_seconds`, `webhook_received_total{result}`, `idempotent_replays_total`, `ratelimit_blocked_total{route}`, `external_api_requests_total{result}`, `circuit_breaker_state`, `queue_depth`, `queue_lag_seconds`, HTTP latency histograms.
- **Dashboards**: booking funnel, payment health, queue health, external API health, p50/p95/p99.
- **Alerts**: stuck payments > 15 min, webhook failure rate, 5xx rate, queue lag, breaker open > 5 min, DB connections near limit, Redis down.
- **Probes**: `/health` (process alive), `/ready` (DB + Redis reachable). Graceful shutdown on `SIGTERM` (stop accepting, drain, close pools).
- `docs/RUNBOOK.md`: how to handle stuck payment, webhook outage, Redis loss, DB failover, provider outage, rollback.

---

## 16. Testing requirements

**Unit**: state machines (legal and illegal transitions), fare calculation, segment overlap helper, idempotency hash, rate limiter policy resolution, signature verification.

**Integration (Testcontainers, real Postgres + Redis, no mocks for these)**:

- 100 concurrent requests for the **last seat** → exactly 1 succeeds, 99 get `SEAT_TAKEN` / `INSUFFICIENT_SEATS`.
- 200 concurrent requests for N seats with auto-pick → no seat allocated twice, no deadlocks.
- Overlapping segment rules: 0→3 and 3→5 succeed on the same seat; 0→5 then 2→4 fails; constraint rejects a hand-crafted conflicting `INSERT` (proves DB-level safety).
- Hold expiry frees seats; an expired-unswept hold does not block a new buyer.
- Idempotency: same key replays; different payload → 422; concurrent same key → one execution.
- Webhook: duplicate delivery → one confirmation; out-of-order events handled; invalid signature rejected; amount mismatch rejected.
- Late payment after expiry → re-acquire or auto-refund.
- Cancel + waitlist promotion is atomic; double cancel no-op.
- Auth rate limiter, lockout, header spoofing (see 8.2).
- External provider: timeout, 429, malformed payload, breaker open, stale fallback, quota guard, single-flight.
- IDOR attempts return 403/404.

**E2E (Playwright)**: search → select seats → hold → pay with Razorpay test credentials/mocked checkout → ticket; two browsers racing for the same seat; payment pending state; offline ticket view; axe accessibility scan on key pages.

**Load (k6, `tests/load/`)**:

- Scenario A: 1,000 virtual users hit the last seat → assert exactly 1 booking.
- Scenario B: mixed browse/search/book traffic with thresholds (e.g. `p(95) < 500ms`, error rate < 1%). Record the numbers you actually achieve.
- Scenario C: login brute-force → verify 429s and lockout.
- After each run, a verification SQL script asserts **no overlapping active allocations** and prints the result for the README.

**Chaos (`tests/chaos/`)**: kill API mid-payment, drop Redis, delay webhooks, replay webhooks, stop worker; then show the system converges to a correct state (reconciler resolves, no double booking, no lost payments).

Coverage gate in CI for `packages/shared` and booking/payment modules.

---

## 17. CI/CD and deployment

### 17.1 CI (GitHub Actions)

On every PR: install (cached) → lint → typecheck → unit tests → integration tests (service containers) → build → Playwright smoke → gitleaks → dependency audit → Lighthouse CI on preview.
On merge to `main`: build and push images → run **migrations** → deploy API/worker → deploy web → smoke test → notify.

**Migrations**: expand/contract (backward-compatible) so rolling deploys and rollbacks are safe. Never edit applied migrations.

### 17.2 Recommended deployment (Tier A: realistic and low cost) — implement this

| Component     | Suggested host                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Web (Next.js) | Vercel (or Cloudflare Pages)                                                                          |
| API + Worker  | Fly.io or Render (Docker, long-running, ≥2 API instances in prod mode; Mumbai region where available) |
| PostgreSQL 16 | Neon (verify `btree_gist` support and pooled/direct connection URLs)                                  |
| Redis         | Upstash or Redis Cloud (use a separate instance or database for BullMQ with `noeviction`)             |
| Edge          | Cloudflare (DNS, WAF, rate-limit rule, Turnstile)                                                     |
| Email         | Resend                                                                                                |
| Monitoring    | Sentry + Grafana Cloud (free tiers)                                                                   |
| Domains       | `app.<domain>` (web), `api.<domain>` (API + WS)                                                       |

Steps the agent must complete and document in `docs/DEPLOY.md`:

1. Provision services, set secrets in the platform (never in git).
2. Set `DATABASE_URL` to Neon's pooled endpoint (hostname contains `-pooler`) for API and worker runtime, and `DATABASE_MIGRATION_URL` to the direct, unpooled endpoint for Prisma CLI migrations. Require TLS (`sslmode=require`), keep the migration URL out of runtime service configuration, and verify Neon supports `btree_gist` before deploying the seat-allocation migration.
3. Run migrations from CI with the migration role and the direct URL.
4. Configure Razorpay **test** webhook URL to `https://api.<domain>/v1/webhooks/razorpay` and set the webhook secret.
5. Configure Cloudflare proxy, TLS full-strict, WAF rules, `/auth/*` rate rule.
6. Verify `/ready`, run the smoke test and a short k6 run against production-like env.
7. Add uptime monitoring on `/health` and the status page.

### 17.3 Production reference (Tier B: describe in `ARCHITECTURE.md`, Terraform optional)

CloudFront + AWS WAF → ALB → ECS Fargate (API and worker services, autoscaling on CPU/RPS/queue depth) → RDS PostgreSQL Multi-AZ + RDS Proxy (or PgBouncer) + read replica → ElastiCache Redis (primary + replica) → S3 (tickets) → SES (email) → Secrets Manager → CloudWatch + OpenTelemetry collector. Blue/green or rolling deploys, automated backups with tested point-in-time recovery.

### 17.4 Environment variables (`.env.example`)

For Neon, copy the pooled connection string (hostname includes `-pooler`) to `DATABASE_URL` and the direct connection string to `DATABASE_MIGRATION_URL`. Both use TLS. Do not run Prisma migrations through the pooler. The application uses the PostgreSQL wire protocol; a Neon management API key is not an application database credential.

```
NODE_ENV=
DATABASE_URL=
DATABASE_MIGRATION_URL=
REDIS_URL=
QUEUE_REDIS_URL=
JWT_ACCESS_SECRET=
REFRESH_TOKEN_PEPPER=
OUTBOX_ENCRYPTION_KEY=
ALLOWED_ORIGINS=
COOKIE_DOMAIN=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
TRAIN_DATA_PROVIDER=railradar
RAILRADAR_API_KEY=
RAILRADAR_MONTHLY_BUDGET=100
RAILRADAR_MINUTE_LIMIT=10
RESEND_API_KEY=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
HOLD_TTL_SECONDS=600
PAYMENT_EXTENSION_SECONDS=300
BOOKING_WINDOW_DAYS=60
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

---

## 18. Phased delivery plan (with acceptance criteria)

**Phase 0: Foundation.** Monorepo, TS strict, lint/format, docker-compose (Postgres, Redis), CI skeleton, health endpoints, pino, env validation (zod), `PROGRESS.md`.
_Accept:_ `docker compose up` + `pnpm dev` runs web and api; CI green.

**Phase 1: Data model and seed.** Prisma schema + raw SQL migrations (incl. exclusion constraint), seat generator, fare rules, run generator, provider-based train import (fixtures first, then live).
_Accept:_ DB has 15+ trains with stops, seats and runs; hand-crafted conflicting insert is rejected by Postgres.

**Phase 2: Auth + rate limiting.** Section 8 complete, with tests.
_Accept:_ all limiter tests pass; brute-force k6 script yields 429s; refresh reuse detection works.

**Phase 3: External data layer.** Section 7 complete (provider, cache, breaker, quota, fallback, fixtures, metrics).
_Accept:_ live status works with real key; kill the network and the API still returns stale data; no browser-side calls to provider.

**Phase 4: Booking engine.** Section 5 complete.
_Accept:_ last-seat race test passes (1 of 100); segment tests pass; hold expiry test passes.

**Phase 5: Payments.** Section 6 complete.
_Accept:_ duplicate/out-of-order webhook tests pass; late-payment path tested; reconciler fixes a deliberately lost webhook.

**Phase 6: Realtime, workers, waiting room.** Sections 8.3, 10, 11.
_Accept:_ two browsers see seat state change live; waiting room admits at configured rate; workers survive restart.

**Phase 7: Cancellation, refunds, waitlist.** Section 12.
_Accept:_ cancel→promote atomic test; refund idempotency; no double refund.

**Phase 8: Frontend build.** Section 9 (start the design system right after Phase 1; build pages against the real API as phases land).
_Accept:_ all pages and flows done, Lighthouse and axe budgets met, signature elements (split-flap, Journey Ribbon, segment-aware coach map, ticket stub, hold timer) all present.

**Phase 9: Hardening.** Sections 14, 15, 16 complete: metrics, dashboards, alerts, chaos tests, k6 results recorded.
_Accept:_ load test shows zero overlapping allocations; chaos scenarios converge.

**Phase 10: Deploy.** Section 17.
_Accept:_ public URLs live, CI/CD deploys on merge, Razorpay test payment works end to end in production environment.

**Phase 11: Documentation.** `README.md` (screenshots/GIF, architecture diagram, quick start, live link, test/load results), `ARCHITECTURE.md`, `DESIGN.md`, `RUNBOOK.md`, `DEPLOY.md`, `openapi.yaml`.
_Accept:_ a stranger can run it locally in under 10 minutes.

---

## 19. `docs/DESIGN.md` problem register (generate and keep updated)

Produce a table with columns **Problem | Failure scenario | Solution | Where in code | Test | Trade-off**. It must at least cover:

1. Two users book the last seat simultaneously (atomic allocation, `SKIP LOCKED`, constraint)
2. Check-then-act race (logic pushed into one SQL transaction)
3. Overlapping journey segments (exclusion constraint on `int4range`)
4. Deadlocks with multi-seat selection (ordered locking, retry)
5. Same user booking from two tabs (concurrent hold limit)
6. Double-click / retry on pay (idempotency keys)
7. Duplicate or out-of-order webhooks (event-id dedupe, state machine)
8. Idempotency key reused with different payload (request hash, 422)
9. Money deducted, booking missing (webhook truth + reconciler)
10. Payment after hold expiry (re-acquire or auto-refund)
11. Forged payment success from client (signature verification)
12. Amount tampering (server-side fare, amount check)
13. Refund failures and double refunds (refund state machine, uniqueness)
14. Abandoned checkout (TTL holds + sweeper, stale-hold-aware allocation)
15. Hold expires mid-payment (one-time extension on payment start)
16. Releasing someone else's lock (holds keyed by booking id; token-checked Redis lock where used)
17. Redis data loss (DB is authority)
18. Cancellation vs waitlist promotion race (single transaction)
19. Waitlist ordering (sequence + `SKIP LOCKED`)
20. Double cancellation (idempotency + state machine)
21. Invalid dates / departed trains (server-side validation)
22. Tatkal burst (waiting room, rate limits, cached reads)
23. Bot abuse (Turnstile, per-account limits)
24. DB bottleneck (PgBouncer, read replica, cached counts, async side effects)
25. Stale availability in UI (advisory display, authoritative hold, live updates)
26. Dual write DB + email (outbox pattern)
27. Partial failures across services (saga/compensation via refunds and release)
28. Clock skew (DB `now()` only)
29. IDOR (ownership checks + tests)
30. Brute-force login (sliding-window limiter, lockout, Turnstile)
31. External API outage/slow/changed (timeout, breaker, cache, stale fallback, schema validation)
32. External API quota exhaustion (budget guard)
33. Cache stampede on cold key (single-flight Redis lock)
34. Poison/failed jobs (retries, dead-letter, alerts)

---

## 20. Definition of Done (whole project)

- [ ] All phases 0–11 accepted; `PROGRESS.md` is current.
- [ ] k6 last-seat test with 1,000 concurrent attempts yields exactly one booking; verification SQL shows zero overlaps.
- [ ] Chaos scenarios documented with results.
- [ ] Rate limiter on auth endpoints verified by tests and a brute-force k6 run.
- [ ] External data works live, and degrades gracefully when the provider is down.
- [ ] UI contains all signature elements, passes AA contrast, keyboard navigation, and performance budgets on mobile.
- [ ] Public deployment with CI/CD, HTTPS, monitoring, alerts, and a status page.
- [ ] No secrets in git history; `.env.example` complete.
- [ ] README includes live link, architecture diagram, screenshots/GIF, load-test numbers, and an honest "limitations" section (demo data, simplified coach layouts, test-mode payments, free-tier API limits, not affiliated with IRCTC).

---

## 21. Out of scope (do not build)

Real IRCTC integration or scraping, real-money payments, card storage, full fare-rule fidelity (Tatkal premium tiers, concessions beyond a simple flag), full Indian Railways coach layout accuracy, chart preparation logic beyond the simplified cutoff.

---

**Start now with Phase 0. Before coding, create `PROGRESS.md` with your Phase 0 plan, then execute.**
