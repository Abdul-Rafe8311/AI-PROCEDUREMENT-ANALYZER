---
title: 'Story 1.2: Plan ledger, effective plan and entitlements endpoint'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '02ca2e638c72686c7a6c9618fdef3f1c802e16f8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-AI PROCEDUREMENT -2026-11-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no record of who holds which plan, so nothing can tell a user's real entitlement; every user must default to Free and fall back to Free on expiry without a job.

**Approach:** Add the append-only `plan_periods` and `audit_log` tables (migration `0005`), a pure `lib/entitlements/` module (`plans.ts`, `effectivePlan`) tested against one shared `cases.json`, a service-role DB helper, and `GET /api/me/entitlements` (guard: jwt). No writers, quota counting or gating yet.

## Boundaries & Constraints

**Always:**
- `lib/entitlements/` has no I/O, no `process.env`, no clock; `now: Date` is a parameter.
- Quota (Free 14, Plus 30, Pro 45, Max 100), chatbox access (Plus+), tender-sheet access (Pro+) and plan rank (free < plus < pro < max) are defined only in `plans.ts`.
- `effectivePlan` = the one non-voided period with `starts_at <= now < ends_at`, else `free`. Plan is read per request from the DB, never cached in memory, cookie, JWT or `user_metadata`.
- `0005_subscriptions.sql` is a new, idempotent file (existing migrations untouched): enables `btree_gist`; creates `plan_periods(id, user_id, plan, starts_at, ends_at, source, payment_request_id, created_by, created_at, voided_at)` and `audit_log(id, actor_email, action, subject_user_id, subject_id, detail jsonb, created_at)`; RLS on both; `plan_periods` has a select-own policy only; `audit_log` has no user policy; no insert/update/delete policy anywhere. Exclusion constraint on `user_id` + `tstzrange(starts_at, ends_at)` where `voided_at is null`; check `ends_at > starts_at`; `plan` limited to plus/pro/max, `source` to payment/admin.
- Any `create function` in `0005` revokes execute from `public`, `anon`, `authenticated`, grants only `service_role`, sets a fixed `search_path`.
- DB access only via service-role client in `lib/server/db.ts`; `SUPABASE_SERVICE_ROLE_KEY` read only through `lib/server/config.ts`.
- Error shape `{ error, code }`.

**Never:**
- No plan writers, `admin_set_plan`, quota counting, `requireFeature`, or UI (Stories 1.3+, 2.x, 3.x).
- Do not edit existing migrations or existing routes' behavior; do not apply the migration to any database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No period | Signed-in user, no rows | 200 `plan: 'free'`, `expiresAt: null`, `queued: []` | N/A |
| Expired / voided | Only `ends_at <= now` or voided rows | `plan: 'free'` | N/A |
| Active + queued | Active Pro plus future non-voided rows | `plan: 'pro'`, `expiresAt`, `queued` ordered by `starts_at` ascending | N/A |
| Placeholder usage | Any user | `used: 0`, `quota` from `plans.ts`, `resetAt: null` | N/A |
| Demo principal | `principal.demo` | `plan: 'max'`, no DB call | N/A |
| Unauthenticated | No/invalid token | 401 `UNAUTHENTICATED` (via guard) | N/A |
| DB failure / service key missing | Query error | 503 `SERVICE_UNAVAILABLE`, logged without secrets | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/supabase/migrations/0001_auth_ownership_rls.sql`, `0004_dashboards.sql` -- idempotent style to copy (`if not exists`, `drop policy if exists`); next file is `0005`.
- `apps/web/src/lib/server/guard.ts` -- `requirePrincipal`; `Principal.demo` marks the synthetic Max user.
- `apps/web/src/lib/server/config.ts` -- already exposes `supabaseUrl`, `supabaseServiceRoleKey`; no changes expected.
- `apps/web/src/app/api/route-guards.test.ts` -- `REQUIRED` map and marker/helper agreement; add `me/entitlements: jwt`.
- `apps/web/src/lib/server/import-boundary.test.ts` -- `lib/entitlements/` may import from `lib/server/` only if it already may; entitlements stay pure and import nothing from `lib/server`.
- `apps/web/src/lib/entitlements/` -- does not exist; create.
- `apps/web/src/lib/api-fetch.ts` -- client helper (unchanged; later UI stories call the endpoint with it).

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/supabase/migrations/0005_subscriptions.sql` -- tables, constraints, RLS, indexes (`plan_periods(user_id, ends_at)`) -- AD-3, AD-12
- [ ] `apps/web/src/lib/entitlements/plans.ts` -- plan type, rank, quota, feature access helpers -- single matrix
- [ ] `apps/web/src/lib/entitlements/effective-plan.ts` -- `effectivePlan(periods, now)` plus `queuedPeriods(periods, now)` -- single reader
- [ ] `apps/web/src/lib/entitlements/cases.json` + `effective-plan.test.ts` -- cases: none, expired, voided, active, boundary `starts_at == now` and `ends_at == now`, queued ordering
- [ ] `apps/web/src/lib/server/db.ts` -- service-role client factory (no session persistence) and `loadPeriods(userId, now)` selecting non-voided rows with `ends_at >= now - 62 days`
- [ ] `apps/web/src/app/api/me/entitlements/route.ts` -- `// guard: jwt`, `requirePrincipal`, build response; `no-store` cache header
- [ ] `apps/web/src/app/api/route-guards.test.ts` -- require `me/entitlements: jwt`
- [ ] `apps/web/src/lib/server/migrations.test.ts` -- greps `0005+` for the revoke/grant/search_path rule on every `create function`, RLS enabled on new tables, no write policies
- [ ] `apps/web/src/app/api/me/entitlements/route.test.ts` -- I/O matrix via injected deps (principal, loader, now)

**Acceptance Criteria:**
- Given an expired Paid Plan with no queued period, when the user's next request is served, then `plan` is `free` with no job or manual step.
- Given a response, then no plan value is stored in a cookie, header other than `Cache-Control: no-store`, JWT or `user_metadata`.
- Given `npm test` and `npx tsc --noEmit` in `apps/web`, then both pass and existing behavior is unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| loadPeriods mapping/filters untested; voided_at not selected | medium | patch | No test imports db.ts; fixed with client seam, voidedAt mapped, db.test.ts |
| Browser roles keep default table write grants (RLS only) | medium | patch | Added revoke insert/update/delete in 0005 |
| No row cap on loader (Supabase 1000 default) | low | patch | Added .limit(500) |
| Migration checked by regex only, no real Postgres test | medium | defer | No DB test infra; SQL side of cases.json is a manual pre-deploy step |
| Append-only not enforced by trigger; provenance check constraints; audit_log indexes | low | defer | Writers arrive in 1.3; add then |
| Timeout on query, 401 no-store header, NaN-date rows, activePeriod picks first on overlap, queue tiebreaker, regex brittleness, no GET-handler 401 test | low | reject | Exclusion constraint prevents overlap; guard tests cover 401; fix adds complexity |
| Redundant index, quota matrix duplicated in tests, btree_gist privileges note | low | reject | No demonstrated harm; migration is applied manually in Supabase dashboard |

## Design Notes

Response shape: `{ plan, expiresAt, queued: [{ plan, startsAt, endsAt }], used: 0, quota, resetAt: null }`. `cases.json` entries are `{ name, now, periods, expected }` so the SQL helper in Story 1.3 can reuse them by hand. The route takes injectable deps (principal, period loader, clock) like `guard.ts`, so tests need no Supabase.

## Verification

**Commands:**
- `cd apps/web && npm test` -- expected: all tests pass including entitlement cases, migration grep and route tests
- `cd apps/web && npx tsc --noEmit` -- expected: no errors
