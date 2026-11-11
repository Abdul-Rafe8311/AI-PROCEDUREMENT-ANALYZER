# Epic 1 Context: Verified Identity, Plan Ledger & Pilot Grants

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The founder can see every user's plan and grant plans manually (Najran pilot on Pro) on a server-verified, auditable entitlement ledger. Every user is Free by default and falls back to Free automatically on expiry. This is the foundation for quotas, gating and payments in later epics; existing extraction, scoring, TA form, report and Excel export behavior must not change.

## Stories

- Story 1.1: Server-verified identity and route guard markers
- Story 1.2: Plan ledger, effective plan and entitlements endpoint
- Story 1.3: Admin identity and manual plan override API
- Story 1.4: Admin Users tab with manual override
- Story 1.5: Deploy the foundation and seed the pilot on Pro

## Requirements & Constraints

- Plan is never trusted from the browser; identity, plan and admin flag are always derived server-side.
- Free is default; a paid plan's expiry passes with no manual step and no job. Data created on a paid plan is retained after fallback.
- Admin can set any user's plan and expiry directly; effective immediately, audited with admin and time.
- Admin page shows each user's current plan for support triage.
- Deployment values (admin emails, support email, bank details, prices, email sender) are configuration, never hard-coded.
- Demo mode: with Supabase env absent and not production, guards return a synthetic Max principal; in production missing config returns 503 and never a principal.

## Technical Decisions

- App is `apps/web` (Next.js 15 App Router, Supabase, Vercel). Browser keeps its localStorage Supabase session; no `@supabase/ssr`. One client helper `apiFetch` attaches `Authorization: Bearer <access_token>` to every `/api/*` call.
- `lib/server/guard.ts`: `requirePrincipal` verifies via `supabase.auth.getUser(token)` once per request, returns `{ userId, email, via: 'jwt' }`; missing/invalid gives 401 `UNAUTHENTICATED`. Identity never read from body/query.
- Every `route.ts` carries `// guard: <class>` (`jwt`, `feature:chat`, `feature:tender_sheet`, `admin`, `apikey`, `token-link`, `cron`, `public`); a test fails on missing/invalid marker or one disagreeing with the helper called.
- Layers: `lib/entitlements/` is pure (no I/O, no env, no clock; `now: Date` parameter); `lib/server/` is server-only and nothing outside `lib/server/` and `lib/entitlements/` may import `lib/server/*` (tested).
- `lib/server/config.ts` is the sole `process.env` reader for new features, validates once, fails closed in production; new env vars documented in `.env.example` only.
- Ledger: append-only `plan_periods` with `btree_gist` exclusion constraint, `voided_at` the only mutation; `effectivePlan(periods, now)` is the single reader; plan matrix only in `lib/entitlements/plans.ts`; shared fixture `lib/entitlements/cases.json`.
- `admin_set_plan` and other writers are SQL functions under one per-user advisory lock, audited in-transaction. Admin = email in `ADMIN_EMAILS` AND user id in `ADMIN_USER_IDS`.
- Migrations are new `0005_*.sql` onward, idempotent, never edit existing files; all new functions revoke execute from public/anon/authenticated, grant to `service_role`, fixed `search_path`; RLS on new tables.
- Error shape `{ "error", "code", ... }` with the defined code set; client branches on `code`.
- `npm test` and `npx tsc --noEmit` before every commit. Fake users/suppliers only in fixtures.

## UX & Interaction Patterns

- Admin nav item visible only to allowlisted admins; non-admins hitting admin routes get the standard redirect/not-found, never an "access denied" page.
- Admin Users tab: search, current plan per user, manual override form (plan, expiry date, optional note) with confirmation text and audit entry shown after.

## Cross-Story Dependencies

- 1.1 provides guards and markers that 1.2-1.4 and later epics reuse; interim `public` markers on `extract`, `chat`, `doc-answer`, `tender-sheet/*` are replaced by Stories 2.1 and 3.1.
- 1.2 (ledger, effective plan, entitlements endpoint) is required by 1.3 and 1.4; 1.5 deploys and seeds the pilot after 1.1-1.4.
