# RailGrid — Progress Log

> Agent working log. Updated at the end of every phase.

---

## Phase 0: Foundation — STATUS: DONE ✅

- pnpm workspaces + Turborepo monorepo
- packages/shared: Zod schemas, state machines (Booking/Payment/SeatAllocation FSMs), constants, error codes
- packages/db: Full Prisma schema (15+ tables) + PrismaClient singleton; `prisma generate` ✅
- apps/api: Fastify + zod type provider + CORS + Helmet + /health + /ready + /metrics + graceful shutdown
- apps/worker: BullMQ stub with graceful shutdown
- apps/web: Next.js 14 App Router + Tailwind design tokens (ink/paper/amber/rail-blue/chalk/steel) + Barlow Condensed/Instrument Sans/JetBrains Mono fonts
- infra/docker-compose.yml: PostgreSQL 16 (btree_gist) + Redis 7 (cache) + Redis 7 (queue, noeviction)
- .github/workflows/ci.yml: lint → typecheck → test → build → gitleaks
- .env.example: all 20+ variables from section 17.4

---

## Phase 1: Data Model & Seed — STATUS: DONE ✅

- Raw SQL migrations with `btree_gist` GiST exclusion constraint on `seat_allocations`
- 23 stations, 15 trains, 3,900 seats, 900 run slots seeded to Neon
- `prisma migrate deploy` ✅ (Neon), `db:seed` ✅, `verify-segment-constraint.sql` ✅
- Neon selected as hosted PostgreSQL; local docker-compose retained for offline dev

---

## Phase 2: Auth + Rate Limiting — STATUS: DONE ✅

- Argon2id (19 MiB, 2 iter, p=1), HS256 access tokens (15 min), opaque hashed refresh tokens with family rotation/reuse revocation
- Routes: register, login, refresh, logout, verify-email, forgot-password, reset-password, /me
- httpOnly refresh cookie, CSRF Origin check, 1 MiB body limit, `trustProxy: false`
- Redis Lua sliding-window rate limiter with hashed keys, `Retry-After`, headers; stricter in-process fallback when Redis is down
- Progressive Turnstile after 3 failed login attempts; bounded email lockout (15 min → 1 h cap)
- 8 unit tests pass; Neon integration test ✅: register→verify→login→CSRF rejection→refresh rotation→replay revocation→password reset

---

## Phase 3: External Data Layer — STATUS: IN PROGRESS

- RailRadar provider adapter with Zod-validated `{ success, data, meta }` envelope, normalized UTC output
- Fixture provider + example fixtures for live status, schedule, between-stations, station board
- `GET /v1/trains/:number/live`: 60s cache, 24h last-known-good, stale-while-revalidate, single-flight mutex, 3s timeout, circuit breaker, 30-day quota guard (cache-only at 80%)
- Prometheus counters/gauges for all external call metrics
- 20 unit tests pass (fixture-backed); live Redis cache path not yet exercised
- RailRadar live request returned HTTP 401 (no API key configured); fixture mode is active

### Remaining

- Extend resilience wrappers (cache, circuit breaker, quota) to schedule/search/board methods
- Run Redis-backed quota/single-flight path
- Provide RailRadar API key to validate authenticated live response

---

## Phase 4: Booking Engine — STATUS: DONE ✅

- **`POST /v1/bookings`**: idempotent seat hold — transaction-bound validation, `FOR UPDATE SKIP LOCKED`, stale-hold expiry, DB exclusion constraint as final guard, server-side paise fare, PNR, outbox event, audit log
- **`GET /v1/bookings`** / **`GET /v1/bookings/:id`**: ownership-checked list and detail with seat allocations, passengers, run details, payments
- Unit tests (14): fare paise boundaries, superfast surcharge, segment overlap math (`[0,3)∩[3,5)=false`, `[0,5)∩[2,4)=true`), idempotency hash stability
- Integration test ✅ against Neon: first booking 201, identical replay 201, competing user 409 SEAT_TAKEN

---

## Phase 5: Payments — STATUS: DONE ✅

### What was built

**`POST /v1/bookings/:id/pay`**
- Locks booking row (FOR UPDATE), validates `SEATS_HELD|PAYMENT_PENDING` and non-expired hold
- Extends hold once (`GREATEST(current, now() + PAYMENT_EXTENSION_SECONDS)`)
- Creates Razorpay order (or mock order in test/fixture mode — no key required for dev)
- Inserts `payments` row `CREATED`. Idempotent: same key returns same `orderId`. Audit-logged.

**`POST /v1/payments/verify`** (optimistic browser-redirect path)
- Verifies `HMAC_SHA256(orderId + "|" + paymentId, KEY_SECRET)` with `timingSafeEqual`
- Idempotent via `Idempotency-Key`. Runs shared `runConfirmTransaction()`.

**`POST /v1/webhooks/razorpay`** (source of truth)
- Verifies webhook signature on **raw body** with `RAZORPAY_WEBHOOK_SECRET`
- Deduplicates via `payment_events.gateway_event_id UNIQUE` (`INSERT ... ON CONFLICT DO NOTHING`)
- Handles `payment.captured` and `payment.failed`. Always returns 200 immediately.

**`runConfirmTransaction()`** — shared atomic Read Committed transaction
- Already `CONFIRMED` → idempotent no-op
- `SEATS_HELD|PAYMENT_PENDING` → confirms allocations, booking, payment; enqueues `booking.confirmed`
- `EXPIRED` (late payment) → re-acquires seats via `SKIP LOCKED`; if available → `CONFIRMED`; if gone → `REFUND_DUE`
- Amount mismatch → marks payment `FAILED` (server amount never trusted from gateway)

**`POST /v1/bookings/:id/cancel`**
- Idempotent, checks ownership and that departure hasn't passed
- Single transaction: `seat_allocations → RELEASED`, booking → `CANCELLED`, creates `Refund`, payment → `REFUND_PENDING`
- Enqueues `booking.cancelled` outbox event

### Unit tests (22)
- Razorpay HMAC verify/reject cases, timing-safe comparison
- Booking state machine: 9 legal/illegal transition assertions
- Webhook deduplication logic
- Payment amount mismatch guard

### Verification
- `pnpm --filter @railgrid/api typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/api test` ✅ **56 tests pass** (22 payment + 14 booking + 9 train-data + 8 auth + 3 route)
- Pushed to GitHub: commit `13099ad`

### Remaining
- Integration test for pay→webhook→confirm→cancel flow against Neon (needs Razorpay test key)
- Reconciliation worker (`reconcile-payments` BullMQ job, every 2 min) — deferred to Phase 6
- Partial refund rules per `fare_rules` (cancellation fee) — currently full refund
- Email delivery for `booking.confirmed` — awaits outbox worker in Phase 6

---

## Phase 6: Realtime, Workers, Waiting Room — STATUS: DONE ✅

### What was built

**BullMQ Worker Pool (`apps/worker`)**
- Wired to `QUEUE_REDIS_URL` (noeviction policy) with separate cache Redis for pub/sub.
- Graceful shutdown handles `SIGTERM`/`SIGINT`, draining active jobs before process exit.
- `expire-holds` repeatable job (every 30s): batch-expires stale `HELD` seat allocations and `SEATS_HELD` bookings; publishes `seat.released` event to Redis channel `run:{runId}`.
- `reconcile-payments` repeatable job (every 2m): queries `CREATED` payments older than 3 minutes, reconciles with Razorpay API, triggers `runConfirmTransaction()`, and alerts if unresolved past 15 minutes. Fixture mode active in dev/CI.
- `outbox-publisher` repeatable job (every 1s): polls unpublished outbox events with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100`, routes events into `send-email` and `generate-ticket` BullMQ queues, and atomically updates `published_at`.
- `send-email` consumer: idempotent via BullMQ `jobId`; formats booking confirmations, cancellations, email verification, and password resets; delivers via Resend API or logs safely in fixture mode.
- `generate-ticket` consumer: generates cryptographically signed QR tokens (`HMAC-SHA256`) containing PNR, booking ID, and user ID with a 1-year expiry.

**WebSocket Realtime Feed (`apps/api`)**
- `GET /v1/ws/token`: issues short-lived (60s) HMAC-signed authentication tokens for authenticated passengers.
- `GET /v1/ws`: WebSocket upgrade route with heartbeat ping/pong (30s interval), per-user concurrent connection cap (max 5), subscription multiplexing (up to 10 runs per socket), and automatic Redis pub/sub channel routing (`run:{runId}`).
- `POST /v1/bookings` immediately publishes `seat.held` to Redis upon hold creation.

**Waiting Room (`apps/api`)**
- `POST /v1/waiting-room/join`: joins FIFO queue via Redis sorted set (`ZADD wr:{runId} <score> <userId>`).
- `GET /v1/waiting-room/status`: returns 1-indexed queue position and total length via `ZRANK` and `ZCARD`.
- `DELETE /v1/waiting-room/leave`: leaves waiting room via `ZREM`.

### Verification
- `pnpm --filter @railgrid/shared typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/db typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/api typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/worker typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/api test` ✅ **56 tests pass**
- `pnpm --filter @railgrid/worker test` ✅ **14 tests pass**
- **Total: 70 unit tests pass** across the workspace.

---

## Phase 7: Cancellation, Refunds & Waitlist — STATUS: DONE ✅

### What was built

**Tiered Cancellation Fees (`computeCancellationFeePaise`)**
- Strict policy per agent.md § 6.4 / § 12:
  - `> 48h` before departure: 10% fee (90% refund)
  - `24h – 48h`: 25% fee (75% refund)
  - `12h – 24h`: 50% fee (50% refund)
  - `< 12h` or past departure: 100% fee (no refund)
- Exact integer paise rounding with floor/ceiling checks guaranteeing refund never exceeds `totalPaise`.
- Departure check rejects cancellation after train departs (`400 TRAIN_DEPARTED`).

**Atomic Waitlist Promotion & Cancellation Flow (`POST /v1/bookings/:id/cancel`)**
- Single transaction with `ReadCommitted` isolation:
  - Releases seat allocations (`status = 'RELEASED'`).
  - Sets booking status to `CANCELLED`.
  - Computes cancellation fee and creates `refunds` row (`REFUND_PENDING`) with unique constraint on `gateway_refund_id`.
  - Atomic waitlist promotion via `SELECT ... FOR UPDATE SKIP LOCKED` on `waitlist_entries` for the same run and class.
  - Recalculates fare for promoted booking and transitions it to `CONFIRMED`.
  - Publishes `BOOKING_CANCELLED` and `WAITLIST_PROMOTED` outbox events.
  - Emits audit log events for user cancellation and waitlist promotion.
- Double-cancellation is a strict idempotent no-op (returns `alreadyCancelled: true`).

**Waitlist API (`apps/api/src/routes/waitlist.ts`)**
- `POST /v1/bookings/waitlist`: Join waitlist for a sold-out run and class; computes next sequential position (`MAX(position_seq) + 1`).
- `GET /v1/bookings/waitlist/status`: Query active waitlist position.
- `POST /v1/bookings/waitlist/:id/leave`: Leave waitlist and mark status `CANCELLED`.

**Process Refund Worker (`apps/worker/src/jobs/process-refund.ts`)**
- BullMQ worker for `process-refund` queue with exponential backoff retries.
- Razorpay refund API client integration.
- Fixture fallback for dev/CI automatically marking `REFUNDED` with `mock_refund_<id>`.

### Verification
- `pnpm --filter @railgrid/shared typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/db typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/api typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/worker typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/web typecheck` ✅ (0 errors)
- `pnpm --filter @railgrid/api test` ✅ **70 tests pass** (14 phase7 + 22 payment + 14 booking + 9 train-data + 8 auth + 3 route)
- `pnpm --filter @railgrid/worker test` ✅ **14 tests pass**
- **Total: 84 unit tests pass** across the workspace.

---

## Phase 8: Frontend Build — PLAN

**Goal**: Complete Next.js 14 App Router frontend matching design tokens, railway typography, and all signature UI elements specified in agent.md § 9.

**Signature UI Elements**:
1. `SplitFlapBoard.tsx` — Mechanical flip animation for train departures, status, platform, and delay indicators.
2. `JourneyRibbon.tsx` — Station-to-station route progress track with stops, timings, distance, and platform numbers.
3. `CoachMap.tsx` — Interactive, segment-aware coach seat selection grid with class filter (SL, 3A, 2A, CC), berth types (LB, MB, UB, SL, SU, WINDOW, AISLE), and real-time occupied/held status.
4. `TicketStub.tsx` — Authentic IRCTC-style printable ticket card with PNR, QR code (HMAC token), passenger table, and fare breakdown.
5. `HoldTimer.tsx` — 10-minute seat hold countdown ticker synchronized with WebSocket events.

**Pages & Routes**:
- `/` — Hero search with Station autocomplete, date picker, class selector, recent searches, live status banner.
- `/trains` — Train search results with Split-flap board header, fare badges, class availability cards, filter sidebar.
- `/booking/[runId]` — Segment coach map, passenger form (up to 6 passengers with berth preferences), hold timer ticker.
- `/payment/[bookingId]` — Order summary, breakdown of base fare + GST + reservation fee, simulated / live Razorpay checkout.
- `/ticket/[pnr]` — Ticket stub with downloadable receipt and cancellation action.
- `/waitlist/[runId]` — Live waitlist position tracker.
- `/my-bookings` — Booking history tabs (Active, Completed, Cancelled).
- `/auth/login` & `/auth/register` — Accessible auth forms with rate-limit and lockout messaging.

---

## Deviations

- `agent.md` listed approximately 300 requests/day for RailRadar. Current docs: 100/month, 10/min on Free Sandbox. Implementation uses rolling 30-day budget.
- RailRadar live request returned HTTP 401 (no API key). Fixture adapter active in dev/CI.
