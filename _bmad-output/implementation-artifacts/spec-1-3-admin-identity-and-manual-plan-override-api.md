---
title: 'Story 1.3: Admin identity and manual plan override API'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '4e39cdf8a40759f8d0c83989310cd133bc8904d0'
route: 'dispatch'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-AI PROCEDUREMENT -2026-11-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The founder cannot grant a plan without a payment, so the Najran pilot users cannot be put on Pro, and there is no server-verified admin identity or audited writer for `plan_periods`.

**Approach:** Add `requireAdmin` (email in `ADMIN_EMAILS` AND user id in `ADMIN_USER_IDS`), the SQL function `admin_set_plan` (migration `0006`, per-user advisory lock, audited in-transaction), and `GET`/`POST /api/admin/users` (guard: admin). No UI (Story 1.4).

## Boundaries & Constraints

**Always:**
- `requireAdmin(req, deps?)` calls `requirePrincipal`, then requires the lower-cased principal email in `config.adminEmails` AND `userId` in `config.adminUserIds`; otherwise 403 `{ error, code: 'FORBIDDEN' }`. Principal failures pass through unchanged (401/503). In production an empty `adminUserIds` makes every admin request 403. Demo principal is allowed only when `principal.demo` (already gated by `requirePrincipal`).
- Acting identity (`admin_email`) comes only from the principal, never body/query. Target user id is a body parameter only.
- `0006_admin_set_plan.sql`: new idempotent file, existing migrations untouched, not applied to any database. `admin_set_plan(p_user_id uuid, p_plan text, p_ends_at timestamptz, p_admin_email text)` is `security definer`, fixed `set search_path = public, pg_temp`, first runs `pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))`, rejects unknown plan or `p_ends_at <= now()` with an exception, sets `voided_at = now()` on every non-voided period with `ends_at > now()`, inserts one `source='admin'` period (`starts_at = now()`, `created_by = p_admin_email`), writes an `audit_log` row (`action 'admin_set_plan'`, `actor_email`, `subject_user_id`, `detail` = plan, ends_at, voided period ids) in the same transaction, returns the new period id. Revoke execute from `public`, `anon`, `authenticated`; grant only `service_role`.
- `POST /api/admin/users` body `{ userId, plan, endsAt }` (plan in plus/pro/max; `endsAt` ISO, strictly in the future); invalid input returns 400 `{ error, code: 'VALIDATION', fields: { <name>: <message> } }` before any DB call. Success 200 `{ periodId, plan, endsAt }`. Unknown user id returns 404 `NOT_FOUND`.
- `GET /api/admin/users?search=` returns `{ users: [{ id, email, createdAt, plan, expiresAt }] }`: users listed via Supabase auth admin API (service role), email filtered case-insensitively in code by `search` (all users if empty), capped at 50, each with `effectivePlan` computed from their periods (one batched query). Both methods set `Cache-Control: no-store`.
- Responses never echo secrets; DB/config failures return 503 `SERVICE_UNAVAILABLE`, logged without secrets. Error shape `{ error, code }`.

**Never:**
- No UI, payment tables, `decide_payment_request`, API keys, email sending, or changes to existing routes (Stories 1.4+, 2.x).
- Do not edit existing migrations or `plan_periods` rows outside `admin_set_plan`; do not apply the migration.
- Do not add a plan value to JWT, cookie or `user_metadata`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin ok | Email and id both allowlisted | handler runs | N/A |
| Email only | Email in list, id absent or `ADMIN_USER_IDS` empty | 403 `FORBIDDEN` | N/A |
| Non-admin / no token | Signed-in non-admin; bad token | 403 `FORBIDDEN`; 401 `UNAUTHENTICATED` | N/A |
| Override | Valid body, user has active Plus plus queued row | old rows voided, one admin period from now, audit row | N/A |
| Bad input | Past `endsAt`, plan `free`/unknown, missing `userId` | 400 `VALIDATION` with `fields` | no DB call |
| Unknown user | `userId` not in auth users | 404 `NOT_FOUND` | N/A |
| Search | `search=naj` | matching users with plan and expiry | N/A |
| Expiry | Override `endsAt` passes | user is Free via `effectivePlan` | N/A |
| Service failure | RPC/query error, key missing | 503 `SERVICE_UNAVAILABLE` | logged, no secrets |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/server/guard.ts` -- `requirePrincipal`, `Principal`, `GuardDeps`, `reply`; add `requireAdmin` here, reusing `GuardDeps` (config includes `adminEmails`, `adminUserIds`, `production`).
- `apps/web/src/lib/server/config.ts` -- already parses `adminEmails` (lower-cased) and `adminUserIds`; no change.
- `apps/web/src/lib/server/db.ts` -- `serviceClient()`, `loadPeriods`, `DbUnavailableError`; add `adminSetPlan(...)` (rpc) and `listUsersWithPlans(search, now)`. Test with the existing client-seam style in `db.test.ts`.
- `apps/web/src/lib/server/me-entitlements.ts` -- pattern for an injectable-deps response builder; mirror as `lib/server/admin-users.ts`.
- `apps/web/src/lib/entitlements/effective-plan.ts` -- `effectivePlan`, `activePeriod` reused for GET; do not reimplement.
- `apps/web/src/app/api/route-guards.test.ts` -- add `'admin/users': 'admin'` to `REQUIRED`; its admin check already requires a `requireAdmin(` call; extend it to require the early return like `jwt`.
- `apps/web/src/lib/server/migrations.test.ts` -- auto-covers `0006` (revoke/grant/search_path).
- `apps/web/supabase/migrations/0005_subscriptions.sql` -- idempotent style and `plan_periods`/`audit_log` columns to match.
- `apps/web/src/lib/entitlements/cases.json` -- the SQL writer's semantics must agree by hand (manual pre-deploy check, as in 1.2).
- `apps/web/.env.example` -- `ADMIN_EMAILS`/`ADMIN_USER_IDS` already documented; no change.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/server/guard.ts` -- add `requireAdmin` -- AD-7
- [x] `apps/web/src/lib/server/guard.test.ts` -- admin matrix: both listed, email only, id only, empty ids in production, case-insensitive email, demo, 401 passthrough
- [x] `apps/web/supabase/migrations/0006_admin_set_plan.sql` -- function, lock, void, insert, audit, revoke/grant -- AD-6
- [x] `apps/web/src/lib/server/db.ts` -- `adminSetPlan`, `listUsersWithPlans`, plus tests in `db.test.ts`
- [x] `apps/web/src/lib/server/admin-users.ts` -- validation and GET/POST builders with injected deps
- [x] `apps/web/src/app/api/admin/users/route.ts` -- `// guard: admin`, GET and POST, `requireAdmin`, early return on `!g.ok`
- [x] `apps/web/src/lib/server/admin-users.test.ts` -- I/O matrix via injected deps
- [x] `apps/web/src/app/api/route-guards.test.ts` -- require `admin/users: admin` and early return

**Acceptance Criteria:**
- Given a caller whose email is allowlisted but whose id is not (or production with empty `ADMIN_USER_IDS`), when they call an admin route, then 403 `FORBIDDEN`.
- Given `admin_set_plan` with `ends_at > now`, when it runs, then every non-voided period with `ends_at > now` is voided, one `source='admin'` period starts now, and an `audit_log` row is written in the same transaction.
- Given an invalid plan or past `endsAt`, when posted, then 400 `VALIDATION` with `fields` and no DB call.
- Given `npm test` and `npx tsc --noEmit` in `apps/web`, then both pass and existing behavior is unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

Supabase has no email-search API, so GET pages through `auth.admin.listUsers` and filters in code; acceptable at pilot scale and noted for revisit. Plans are fetched with a single `plan_periods` query `in (user_ids)`, non-voided, same 62-day lookback as `loadPeriods`. `admin_set_plan` raises distinct SQL exceptions (`invalid_plan`, `ends_at_not_future`) the TS layer maps to 400; user existence is checked in TS via `auth.admin.getUserById` (404) before the RPC. The advisory lock key must match what later writers (`decide_payment_request`) use: `hashtextextended(user_id::text, 0)`.

## Verification

**Commands:**
- `cd apps/web && npm test` -- expected: all tests pass including admin guard, route, db and migration grep tests
- `cd apps/web && npx tsc --noEmit` -- expected: no errors
