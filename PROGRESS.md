# RailGrid — Progress Log

> Agent working log. Updated at the end of every phase.

---

## Phase 0: Foundation — PLAN

**Goal**: Monorepo skeleton, TypeScript strict, lint/format, docker-compose (Postgres + Redis), CI skeleton, health endpoints, pino logging, env validation (zod), PROGRESS.md.

**Acceptance criteria**: `docker compose up` + `pnpm dev` runs web and api; CI green.

### Steps

1. Init pnpm workspace + Turborepo config
2. Create apps/api (Fastify), apps/web (Next.js), apps/worker (BullMQ), packages/shared, packages/db
3. TypeScript strict config (shared tsconfig base)
4. ESLint + Prettier
5. docker-compose.yml (Postgres 16 with btree_gist, Redis 7)
6. Infra: Dockerfiles for api + worker
7. API: /health, /ready, /metrics placeholder endpoints; pino logging; zod env validation
8. Web: Next.js app router scaffold with design tokens
9. GitHub Actions CI skeleton
10. .env.example with all variables from section 17.4

### Decisions

- Using pnpm workspaces + Turborepo as specified
- Fastify with fastify-type-provider-zod
- Node 20 LTS
- PostgreSQL 16, Redis 7

---

## Phase 0: Foundation — STATUS: DONE ✅

### What was built

- pnpm workspaces + Turborepo monorepo
- packages/shared: Zod schemas, state machines (Booking/Payment/SeatAllocation FSMs), constants, error codes
- packages/db: Full Prisma schema (15+ tables) + PrismaClient singleton; `prisma generate` ✅
- apps/api: Fastify + zod type provider + CORS + Helmet + /health + /ready + /metrics + graceful shutdown
- apps/worker: BullMQ stub with graceful shutdown
- apps/web: Next.js 14 App Router + Tailwind design tokens (ink/paper/amber/rail-blue/chalk/steel) + Barlow Condensed/Instrument Sans/JetBrains Mono fonts
- infra/docker-compose.yml: PostgreSQL 16 (btree_gist) + Redis 7 (cache) + Redis 7 (queue, noeviction)
- .github/workflows/ci.yml: lint → typecheck → test → build → gitleaks
- .env.example: all 20+ variables from section 17.4
- docs/ARCHITECTURE.md, DESIGN.md, RUNBOOK.md

### Verification

- `pnpm install` → exit 0, 274 packages
- `prisma generate` → exit 0, v5.22.0
- `pnpm typecheck` → 5/5 packages pass, 0 errors

### Fixes during build

1. Prisma schema: added missing `seatAllocations SeatAllocation[]` backrelation on Run
2. error-handler.ts: removed non-existent `hasZodFastifySchemaValidationErrors` import
3. apps/api/package.json: added missing `fastify-plugin` dependency

---

## Phase 1: Data Model & Seed — PLAN

**Goal**: Raw SQL migrations (incl. `btree_gist` exclusion constraint), seat generator, fare rules, run generator, fixture-based train import (15+ popular trains with stops and distances).

**Acceptance criteria**: DB has 15+ trains with stops, seats and runs; hand-crafted conflicting INSERT is rejected by Postgres with error 23P01.

### Steps

1. Raw SQL migrations directory (`packages/db/migrations/`) with numbered files
2. Migration 001: extensions (uuid-ossp, btree_gist, pg_trgm)
3. Migration 002: all tables from Prisma schema (run `prisma migrate dev` to generate, then add raw SQL for exclusion constraint)
4. Migration 003: seat_allocations with exclusion constraint (hand-written, Prisma cannot express this)
5. Fare rules seed data (SL, 3A, 2A, CC)
6. Station data for 15+ major Indian railway stations
7. 15+ popular trains (Rajdhani, Shatabdi, Vande Bharat, Express) with full stops and distances
8. Seat generator: generate realistic coach+seat layouts per class
9. Run generator: create runs for next 60 days per train
10. `pnpm db:seed` script that runs all of the above
11. `pnpm db:seed-runs` for run generation only (can be run separately)
12. Test: hand-crafted conflicting INSERT → verify 23P01 exclusion violation
13. Test: overlapping segment 0→3 and 3→5 on same seat succeeds; 0→5 blocks 2→4

---

## Phase 1: Data Model & Seed — STATUS: DONE ✅

### Work completed so far

- Generated the initial PostgreSQL migration from the checked-in Prisma schema and added `uuid-ossp`, `btree_gist`, and `pg_trgm` extensions.
- Added a follow-up raw SQL migration with database checks and the GiST exclusion constraint on `(run_id, seat_id, int4range(from_idx, to_idx))` for HELD/CONFIRMED allocations. Adjacent half-open segments remain bookable.
- Added idempotent fixture seed data for 23 stations, 15 trains, simplified class seat layouts, four paise-based fare rules, and 60 days of runs. Fixtures are explicitly demo approximations, not authoritative train schedules.
- Added `pnpm --filter @railgrid/db db:seed-runs` and a rollback-only SQL verification script for the adjacent/overlapping segment cases.
- Restored the missing `infra/docker-compose.yml` and Postgres migration-role initializer discovered while following the phase verification plan; it defines Postgres 16 and separate cache/queue Redis 7 services.

### Verification

- `pnpm --filter @railgrid/db typecheck` ✅
- `prisma validate` ✅
- `prisma migrate deploy` against Neon ✅ (both migrations applied through the direct endpoint)
- `pnpm --filter @railgrid/db db:seed` against Neon ✅ (23 stations, 15 trains, 3,900 seats, 900 run slots)
- `prisma db execute --file prisma/verify-segment-constraint.sql` against Neon ✅ (rollback-only adjacent/overlap constraint check)

### Decisions / deviations

- The seed data is a clearly labeled static demo fixture; provider-backed importing remains deferred to Phase 3, where the current RailRadar docs and live response will be verified before implementing the integration.
- Docker Compose was absent despite the Phase 0 completion entry, so a local database/cache compose file has been added as prerequisite infrastructure for Phase 1 verification.
- Neon is now the selected hosted PostgreSQL provider by user direction. Runtime will use Neon's pooled endpoint in `DATABASE_URL`; Prisma migrations will use the unpooled direct endpoint in `DATABASE_MIGRATION_URL`. Local Compose remains an offline development option.
- The user supplied Neon's pooled `DATABASE_URL`; the corresponding direct hostname was derived locally for migrations and stored only in ignored `.env`. No Neon credential was written to tracked files.

---

## Phase 2: Auth + Rate Limiting — PLAN

**Goal**: Implement secure auth flows and reusable abuse controls against the Neon-backed schema and Redis, following agent.md section 8.

**Acceptance criteria**: password hashing and refresh-token reuse detection work; auth limit policies are atomic and tested; requests return stable 429 responses; spoofed forwarding headers cannot bypass client-IP controls.

### Steps

1. Add Phase 2 test coverage for token rotation/reuse and sliding-window limit boundaries before the corresponding risky implementation.
2. Add argon2id password hashing, access-token signing/verification, refresh-token rotation, family revocation, and persisted verification/reset token records.
3. Add register, login, refresh, logout, email verification, forgot-password, and reset-password routes with Zod validation and generic account-enumeration-safe responses.
4. Add httpOnly refresh cookie, origin/custom-header CSRF checks, and secure cookie settings by environment.
5. Add the Redis Lua sliding-window limiter, route policies, standard rate-limit headers, trusted proxy/IP handling, and strict local fallback on Redis errors.
6. Wire API startup/shutdown to the shared Redis and Prisma clients; add auth route documentation and focused integration checks.

### Decisions

- Keep Neon credentials server-side, using the already configured Prisma pooled runtime connection and direct migration connection.
- Store refresh and action-token hashes only. Verification/reset emails are queued to the outbox with short-lived action tokens encrypted under the dedicated `OUTBOX_ENCRYPTION_KEY`; the worker will decrypt them during delivery.
- Never trust arbitrary `X-Forwarded-For`; direct client IP is the default until an explicit trusted proxy configuration is added.

### Work completed so far

- Added Argon2id password hashing at OWASP's current minimum configuration (19 MiB, 2 iterations, parallelism 1), dummy-password verification for unknown emails, HS256 15-minute access tokens, and hashed opaque refresh tokens with family rotation/reuse revocation.
- Added the `auth_tokens` table with expiry/consume state and purpose checks; applied the migration plus a unique refresh-token-hash migration to Neon.
- Implemented `/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/verify-email`, `/forgot-password`, `/reset-password`, `/csrf`, and protected `/me` routes.
- Added httpOnly refresh cookies, CSRF cookie/header plus Origin checks, strict CORS, 1 MiB request bodies, and explicit `trustProxy: false`.
- Added atomic Redis Lua sliding-window policies with hashed keys, rate headers, `Retry-After`, and capped, stricter in-process fallback. Added progressive Turnstile requirements and bounded email lockout, with lockout notices in the outbox.
- Added root `.env` loading for the API/worker and generated local auth secrets in ignored `.env`; removed an undeclared `pino-pretty` transport that prevented API startup.
- Added unit tests for JWT tampering/expiry, token hashing/encryption, refresh reuse classification, sliding-window boundaries, Argon2id, and lockout thresholds. Added an opt-in Neon integration flow with cleanup.

### Verification

- `pnpm --filter @railgrid/api typecheck` ✅
- `pnpm --filter @railgrid/api test` ✅ (8 unit tests; Neon integration skipped by default)
- `RAILGRID_INTEGRATION_TESTS=1 pnpm --filter @railgrid/api test -- src/routes/auth.integration.test.ts` ✅ against Neon: register → verify → login → protected profile → CSRF rejection → refresh rotation → replay revocation → password reset → old/new password checks; temporary user and related rows cleaned up.
- The Neon integration flow verified the no-Redis fallback admitted exactly 3 of 4 concurrent requests and ignored spoofed `X-Forwarded-For`; the latest run also completed with Docker Redis running, exercising the Redis-backed route limiter.

### Remaining for Phase 2 acceptance

- The Redis-backed limiter now runs locally; a sustained brute-force/load run and Turnstile live challenge are still pending.
- Verification/reset and lockout notifications are durably queued, but email delivery awaits the outbox worker/provider phase.
- Turnstile's live verification call has not been exercised with an issued challenge token.

---

## Phase 3: External Data Layer — PLAN

**Goal**: Integrate the documented RailRadar API behind a server-only provider with validated responses, cache-first live status, conservative quota controls, outage fallback, fixtures, and metrics.

**Acceptance criteria**: the live status endpoint works from fixtures; provider responses are validated and normalized; stale cached data is returned during outages; provider calls are bounded and observable; no provider credential reaches the browser.

### Steps

1. Verify current RailRadar docs and make a real endpoint request without exposing credentials; save any authorized successful response as a fixture.
2. Add schemas from the current documented response envelope, provider/fixture implementations, and normalized outputs.
3. Add Redis cache, single-flight, rolling quota guard, timeout/retries, and a circuit breaker with stale fallback.
4. Expose `GET /v1/trains/:number/live` and provider health/quota/cache metrics.
5. Cover provider validation, cache/stale behavior, quota, breaker, and fixture mode with deterministic tests.

### Decisions

- Neon remains the selected hosted database; Phase 3 train-data fetches are server-side and do not change database ownership or credential handling.
- Current RailRadar docs specify a 100 requests/month free sandbox tier (and 10/minute). Use a conservative 100-request rolling 30-day budget, with cache-only behavior at 80%; do not rely on the old 300/day assumption in `agent.md`.
- Use provider-documented schemas as the contract. Fixture responses are labeled as documentation examples unless a successful authenticated live response can be captured.

## Phase 3: External Data Layer — STATUS: IN PROGRESS

### Work completed so far

- Added a server-only RailRadar live-status adapter for the verified `GET /v1/trains/{number}/live` endpoint. It validates the documented `{ success, data, meta }` envelope and maps provider timestamps to normalized UTC output.
- Added the fixture adapter and saved the provider's published live-response example as `apps/api/src/train-data/fixtures/railradar-live-12919.response.json`; it is explicitly a docs example, not a captured live response.
- Added provider methods and documented-shape Zod validation for schedules, trains between stations, and station live boards. Saved the currently published example response shapes under `apps/api/src/train-data/fixtures/`; fixture-based adapter tests consume those files.
- Added `GET /v1/trains/:number/live` with train-number/date validation, cache-first 60-second freshness, 24-hour last-known-good retention, stale-while-revalidate, Redis token-checked single-flight refresh, 3-second HTTP timeout, bounded GET retries, Retry-After handling, a circuit breaker, and a rolling 30-day shared quota guard that switches to cache-only at 80%.
- Added Prometheus counters/gauges for provider requests, failures, latency, cache hits, stale responses, quota blocks, and circuit state.
- Added a home-page live-status card with minute refresh, loading/unavailable states, stale indication, IST update time, and the required third-party demo attribution. It reads only the public RailGrid API URL; the RailRadar key stays on the API server.
- Kept Neon as the only hosted application database; external train data uses a separate server-only provider credential and does not alter `DATABASE_URL` or `DATABASE_MIGRATION_URL`.
- Corrected `agent.md` and `.env.example`: RailRadar currently documents 100 requests per billing month and 10/minute on its free Sandbox tier; the old 300/day assumption was stale. The implementation conservatively uses a rolling 30-day budget.

### Verification

- RailRadar docs reviewed: https://railradar.in/docs, including live-status, authentication, and rate-limit pages ✅
- A live request to `/v1/trains/12919/live` returned HTTP 401 because no accepted RailRadar key is configured; no key was printed or stored. The authenticated provider path therefore remains unverified.
- `pnpm --filter @railgrid/api test` ✅ (20 passed; Neon integration test skipped by default). Coverage includes fixture-backed schedule, between-station, station-board and live-status mapping, schema drift rejection, retry metadata, cache reuse, stale fallback, quota thresholds, breaker recovery, fixture route, and metrics.
- Web lint and typecheck ✅; web production build ✅ after configuring Next.js to transpile the shared workspace package and resolve its NodeNext `.js` import specifiers.
- `pnpm typecheck` ✅ (5/5 packages)
- `pnpm lint` ✅ (all packages)
- `pnpm build` ✅ (API, worker, and Next.js production builds; the sandbox's initial Google Fonts fetch failure was resolved by rerunning with network access).
- Route checks used Fastify injection with fixture mode. Docker Redis is now running and the auth integration exercised Redis successfully; the train-data Lua cache/quota/single-flight path still needs its Redis-backed run.

### Remaining for Phase 3 acceptance

- Add the cache, quota, retry, and circuit-breaker wrapper to the schedule/search/board methods; current resilience handling is wired to live status.
- Add static train import and weekly schedule refresh; the seeded demo schedules remain the booking data source for now.
- Run the Redis-backed cache/quota/single-flight path with Redis 7.
- Provide a valid RailRadar API key to capture and validate a successful live response and exercise live status end to end.

---

## Phase 4: Booking Engine — PLAN

**Goal**: Add database-authoritative seat holds and idempotent booking creation on top of the seeded Neon inventory.

**Acceptance criteria**: valid booking holds persist; specific and automatic seat selection respect half-open segments; overlapping concurrent requests cannot double-book; fare and hold expiry are computed server-side; idempotent retries replay the original response.

### Steps

1. Add focused tests for fare boundaries, idempotency key reuse/replay, half-open segment selection, and hold expiry.
2. Implement authenticated `POST /v1/bookings` with transaction-bound validation, deterministic seat locking, stale-hold expiry, database exclusion protection, server-side fare/PNR generation, and an outbox event.
3. Add idempotency persistence and transactional response replay for booking creation.
4. Add booking detail/list endpoints with ownership checks and seat/hold details.
5. Verify Neon integration paths, including contention on the last seat and adjacent/overlapping journey segments.

### Phase transition decision

- At the user's direction, booking work starts against the existing Neon seed data while Phase 3 remains marked IN PROGRESS for authenticated RailRadar access and schedule import/refresh.
- This is safe for the booking engine because train schedules, runs, seats, and fares are already stored in Postgres, and the booking path will use only that database state. External train data remains read-only and cannot grant inventory.
- The Phase 3 deferral is explicit: live RailRadar confirmation requires an API key not currently configured; resilience wrappers for non-live provider methods and the static importer/weekly refresh also remain.

## Phase 4: Booking Engine — STATUS: IN PROGRESS

### Work completed so far

- Added authenticated `POST /v1/bookings` with UUID v4 `Idempotency-Key` enforcement, request hashing, replay of the original successful response, and 422 rejection when a key is reused with a different request.
- Added transaction-bound checks for scheduled run, 60-day booking window, future departure, ordered stops, passenger count from the shared schema, active same-user/run holds, and configured fare.
- Added DB-time stale-hold expiry, DB-time 10-minute hold expiry, automatic or specific seat selection, deterministic specific-seat locks, half-open segment conflict checks, and the existing Postgres exclusion constraint as the final concurrency guard.
- Added server-calculated integer-paise fares, PNR generation, passenger/seat allocations, `booking.held` outbox event, and an audit record in the same transaction.
- Added an opt-in Neon integration test that creates two temporary users and verifies successful hold, identical idempotent replay, and rejection of a competing user for the same seat. Test data is cleaned up afterward.

### Verification

- `pnpm --filter @railgrid/api typecheck` ✅
- `pnpm --filter @railgrid/api lint` ✅
- `RAILGRID_INTEGRATION_TESTS=1 pnpm --filter @railgrid/api test -- src/routes/bookings.integration.test.ts` ✅ against Neon: first booking 201, same-key replay 201 with identical response, competing seat request 409 `SEAT_TAKEN`.
- `git diff --check` ✅
- Local smoke check ✅ web page returned HTTP 200 at `http://localhost:3000`; API `/health` and `/ready` returned HTTP 200, with both Neon and Redis reported healthy.

### Remaining for Phase 4 acceptance

- Add unit tests for fare rounding and half-open segment boundaries, plus integration coverage for adjacent segments, automatic selection under contention, same-user concurrent hold limits, and expired-but-unswept holds.
- Add booking list/detail endpoints with ownership checks and expose hold and passenger details.
- Add payment and cancellation phases only after booking hold acceptance; no payment provider credentials are needed for current booking work.

### Configuration needed now

- Neon pooled/direct URLs and local secrets are already configured in ignored `.env`; do not paste these into tracked files.
- Docker Redis is running locally and the API/worker have connected to it in earlier verification.
- No additional configuration is required to continue Phase 4 booking work against seeded inventory.
- RailRadar API key is optional for the booking phase and required only to replace fixture/live-data fallback with authenticated external train updates. Resend and Razorpay configuration belongs to later notification/payment phases.

---

## Deviations

- `agent.md` listed approximately 300 requests/day for RailRadar. The current provider documentation instead states 100/month and 10/minute on Free Sandbox; updated the agreement and implementation budget to match current docs.
- The first real endpoint request returned HTTP 401 because no accepted RailRadar key is present in `.env`. Fixture sample values are copied from the provider's published example and are not represented as live data.
