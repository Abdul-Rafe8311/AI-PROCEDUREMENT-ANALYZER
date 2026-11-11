---
title: 'Story 1.1: Server-verified identity and route guard markers'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '284c84ad67bdb7998eb410032f1d8148398eccb3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-AI PROCEDUREMENT -2026-11-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** API routes trust whatever the browser sends and carry no declared access class, so later plan, quota and admin checks have nothing server-verified to build on.

**Approach:** Add `apiFetch` (Bearer token on every `/api/*` call), a server `requirePrincipal` guard verified via `supabase.auth.getUser`, a validated `lib/server/config.ts`, a `// guard: <class>` marker on every route enforced by tests, and an import-boundary test. Existing behavior of all routes stays unchanged except `ta-form/export-excel`, which becomes `jwt`.

## Boundaries & Constraints

**Always:**
- `requirePrincipal` verifies once per request with `supabase.auth.getUser(token)`; identity is never read from body, query or an unverified claim.
- `lib/server/config.ts` is the sole `process.env` reader for new code; it validates once and fails closed in production. Document new vars in `apps/web/.env.example` (create it) only.
- Error shape `{ error, code }`; 401 uses `UNAUTHENTICATED`.
- `lib/server/*` is imported only from `lib/server/`, `lib/entitlements/` and `src/app/api/**`; nothing in components, pages or other `lib/`.
- The synthetic demo principal is returned ONLY when `NODE_ENV !== 'production'` AND Supabase env is missing; never in production under any config state, and a test proves it.
- Interim marker `public` on `extract`, `chat`, `doc-answer`, `tender-sheet/fill`, `tender-sheet/export` with unchanged behavior.

**Never:**
- No migrations, plan, quota, admin or feature-gate logic (Stories 1.2+, 2.1, 3.1).
- Do not edit `.env*`, `workflow.json`, `analysis-engine.ts`, `extraction-server.ts`, `approval-form-*`, or existing migrations.
- Do not adopt `@supabase/ssr`, cache identity across requests, or read plan from the JWT.
- Do not change `pages/api/report/export.tsx` (Pages Router, outside the marker test scope).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid token | `Authorization: Bearer <valid>` on jwt route | Principal `{ userId, email, via: 'jwt' }`, handler runs | N/A |
| Missing/invalid token | No header, malformed header, or `getUser` error/no user | 401 `{ error, code: 'UNAUTHENTICATED' }` | Handler never runs |
| Demo mode | Supabase env absent, `NODE_ENV !== 'production'` | Synthetic Max-plan principal (`demo: true`), no token needed | N/A |
| Production, no config | Supabase env absent, production | 503 `{ error, code: 'SERVICE_UNAVAILABLE' }`, never a principal | Logged without secrets |
| Client without session | `supabase` null or no session | `apiFetch` sends request with no Authorization header | N/A |
| Marker mismatch | Route lacks marker, invalid class, or calls a helper its class disallows | `npm test` fails naming the route | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/supabase.ts` -- browser client (`supabase`, `isSupabaseConfigured`); `apiFetch` reads `supabase.auth.getSession()`.
- `apps/web/src/app/api/**/route.ts` -- 10 routes, none guarded. Classes: `ta-form/export-excel` jwt; `approve`, `dashboard` token-link; `fx`, `intake`, `extract`, `chat`, `doc-answer`, `tender-sheet/fill`, `tender-sheet/export` public.
- Client `/api/*` callers to switch to `apiFetch`: `app/workspace/page.tsx:441` (extract), `:663` (chat); `components/workspace/tender-sheet-panel.tsx:80`; `components/workspace/approval-form-download.tsx:606`; `lib/rag-client.ts:170` (doc-answer); `lib/tender-sheet/generate.ts:53`; `lib/fx-rates.ts:70` (injectable `endpoint`; keep its fetch injection working). Do not touch `rag-client` calls to `API_BASE` (NestJS).
- `apps/web/src/app/api/ta-form/export-excel/route.ts` -- only route that adopts `requirePrincipal`; has `fail()` helper and `isDev`.
- `apps/web/package.json` -- test script `tsx --test "src/**/*.test.ts"` (node:test).
- No `.env.example` exists; create `apps/web/.env.example`.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/lib/api-fetch.ts` -- `apiFetch(input, init)` wrapper over `fetch` adding Bearer from current session, preserving caller headers -- AD-1 client helper
- [ ] `apps/web/src/lib/server/config.ts` -- memoized `getConfig()` reading Supabase URL/anon key and the full documented var list; `ConfigError` in production when Supabase vars missing or JSON vars malformed -- sole env reader
- [ ] `apps/web/src/lib/server/guard.ts` -- `requirePrincipal(req, deps?)` returning `{ ok, principal } | { ok:false, response }`; injectable verifier for tests; demo/503 rules -- AD-1
- [ ] `apps/web/src/lib/server/guard.test.ts` -- cover I/O matrix rows (valid, missing, malformed, getUser error, demo, production 503) with injected verifier/config
- [ ] `apps/web/src/app/api/**/route.ts` (10) -- add `// guard: <class>` marker as first line; wire `requirePrincipal` in `ta-form/export-excel` only
- [ ] `apps/web/src/app/api/route-guards.test.ts` -- every route has a valid marker; required classes for named routes; marker agrees with helper called (`requirePrincipal`/`requireFeature`/`requireAdmin` detected in source)
- [ ] `apps/web/src/lib/server/import-boundary.test.ts` -- fails if a file outside allowed dirs imports `lib/server/*` (`@/lib/server`, relative paths)
- [ ] callers listed in Code Map -- replace `fetch('/api/...')` with `apiFetch`
- [ ] `apps/web/.env.example` -- document `ADMIN_EMAILS`, `SUPPORT_EMAIL`, `BANK_DETAILS`, `PLAN_PRICES_USD`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_USER_IDS`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` plus existing Supabase vars

**Acceptance Criteria:**
- Given a signed-in browser, when any client code calls `/api/*`, then the request carries `Authorization: Bearer <access_token>`.
- Given `approve`, `dashboard`, `fx`, `intake`, `extract`, `chat`, `doc-answer`, `tender-sheet/*`, then behavior is unchanged (NFR9).
- Given `npm test` and `npx tsc --noEmit` in `apps/web`, then both pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| apiFetch attaches token to any URL | medium | patch | `fx-rates` endpoint is injectable; absolute URL would receive the Supabase token |
| apiFetch has no test | medium | patch | No test references `apiFetch`; export-excel depends on its header |
| getUser transport/5xx errors reported as 401 | medium | patch | catch and error branches in `guard.ts` all return 401 |
| Partial Supabase config (one var) gives demo principal | medium | patch | `configured` false when either var missing; demo returned outside production |
| route-guards test matches comments / ignores `g.ok` check | medium | patch | regex runs on raw source; commented call satisfies jwt |
| No behavioral test of export-excel 401 | medium | patch | all route tests are textual |
| No config.test.ts | medium | patch | `loadConfig` never called by any test |
| Demo principal on custom NODE_ENV (staging/preview) | low | defer | Rule is the user's explicit requirement (not production AND env missing); residual risk noted |
| JSON config shape unvalidated; failures not memoized | low | defer | No consumer exists until Epic 4 |
| `server-only` package / AST import parsing / route.tsx names | low | defer | Regex test works for current tree; hardening only |
| pages/api/report/export has no marker | low | defer | Spec excludes it; outside app/api |
| 401 handling in approval-form-download | low | defer | Server message `Sign in required.` surfaces via existing error path; UX polish |
| Public routes unguarded | false | reject | Interim `public` is the spec's explicit requirement |
| fx via apiFetch adds latency | low | reject | Negligible; fix adds complexity |
| `__dirname`/Windows paths | false | reject | Tests ran under tsx; project is macOS/Linux |
| Marker must be exactly line 1; Request+init header merge | low | reject | Cosmetic, no demonstrated harm |

## Design Notes

`requirePrincipal` returns a result union instead of throwing, so handlers stay explicit: `const g = await requirePrincipal(req); if (!g.ok) return g.response;`. The synthetic demo principal is `{ userId: 'demo-user', email: 'demo@example.com', via: 'jwt', demo: true }`; Story 1.2 reads `demo` to grant Max. `SERVICE_UNAVAILABLE` is a code outside the architecture's listed set, added because AD-1 mandates 503 for missing production config.

## Verification

**Commands:**
- `cd "apps/web" && npm test` -- expected: all tests pass including new guard, marker and boundary tests
- `cd "apps/web" && npx tsc --noEmit` -- expected: no errors
