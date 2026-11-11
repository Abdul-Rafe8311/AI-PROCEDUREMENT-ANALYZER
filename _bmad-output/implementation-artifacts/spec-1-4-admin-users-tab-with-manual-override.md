---
title: 'Story 1.4: Admin Users tab with manual override'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '903a80d7694da7515707fe0d972687658ea1c825'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-AI PROCEDUREMENT -2026-11-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin API from Story 1.3 has no UI, so the founder still cannot find a user or grant a plan (the Najran pilot) without calling the API by hand, and cannot see who changed a plan and when.

**Approach:** Add an `/admin` Users page (search, plan and expiry per user, override dialog with confirmation, audit line under the row) and an Admin nav item shown only to admins. The browser learns "admin" from the server (`isAdmin` on `GET /api/me/entitlements`), never from its own config. Extend the GET of the 1.3 API with each user's latest audit entry. No note field (decided by the human).

## Boundaries & Constraints

**Always:**
- `isAdmin` = `requireAdmin` rule (email AND id allowlisted), computed server-side; demo principal gets `isAdmin: false` unless demo admin already passes `requireAdmin`. The Admin nav item renders only when `isAdmin` is true.
- A non-admin (or signed-out, or `isAdmin` false) visiting `/admin` gets Next's standard `notFound()`; never an "access denied" page. Real authorization stays in the API guard.
- No new migration: `admin_set_plan` and `POST /api/admin/users` stay exactly as in Story 1.3 (no `note`). `GET` rows gain `lastChange: { adminEmail, at, plan, endsAt } | null` from the newest `admin_set_plan` audit row per user (one batched query).
- Override form: plan select (plus/pro/max), expiry date input (required, strictly future; sent as end of that local day converted to ISO). No note field. Submit opens a confirmation reading exactly: "Sets {Plan} until {date}, effective immediately. Falls back to Free at expiry. Recorded in the audit log." Confirm calls `apiFetch` POST; on success the row updates and its audit line shows "{admin email}, {date time}". Errors map by `code` (`VALIDATION` shows field messages; `SERVICE_UNAVAILABLE`/other shows a retry toast); the confirmation stays open on error.
- Confirmation is a Dialog at `md+` and a bottom sheet below `md`; focus lands on the dialog title on open, `Esc` closes, only one dialog open at a time, interactive targets ≥44px tall, no horizontal scroll at 320px.

**Never:**
- No payment queue/history tabs, plan matrix changes, quota or gating, email sending, or changes to existing routes other than adding `isAdmin` to the entitlements response.
- Do not add or edit migrations; do not put admin or plan state in JWT, cookie, `user_metadata` or localStorage.
- No client-side admin check substitutes for the API guard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin nav | `isAdmin: true` | Admin item in workspace header | N/A |
| Non-admin | `isAdmin: false` visits `/admin` | `notFound()` page | N/A |
| Search | "najran", debounced | rows: email, plan badge, expiry | empty result: "No users match." |
| Override | Pro, future date | confirm text, POST, row shows Pro + expiry, audit line | N/A |
| Past date | Date today or earlier | inline field error, no dialog, no request | N/A |
| API 400/503 | server rejects | dialog stays open, field message or toast | no state change |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/server/me-entitlements.ts`, `apps/web/src/app/api/me/entitlements/route.ts` -- add `isAdmin` via the same allowlist rule (extract a shared `isAdminPrincipal(principal, config)` in `guard.ts` and have `requireAdmin` use it).
- `apps/web/src/lib/server/guard.ts` -- `requireAdmin` (line ~108 allowlist check); refactor, keep behavior and tests.
- `apps/web/src/lib/server/db.ts` -- `listUsersWithPlans`, `AdminUserRow`; add `lastChange` query on `audit_log` (columns `actor_email, subject_user_id, detail, created_at`).
- `apps/web/src/lib/server/admin-users.ts` -- GET builder passes `lastChange` through; POST unchanged.
- `apps/web/src/lib/api-fetch.ts` -- `apiFetch` for all client calls.
- `apps/web/src/lib/auth-context.tsx` -- `useAuth()`; add an `useEntitlements`-style hook (new `src/lib/use-entitlements.ts`) fetching `/api/me/entitlements`.
- `apps/web/src/components/ui/dialog.tsx` -- Radix Dialog; accept sheet classes via `className`, focus title via `onOpenAutoFocus`.
- `apps/web/src/app/workspace/page.tsx` (~line 708) -- header actions; add `<AdminNavLink />` beside `UserMenu`.
- `apps/web/src/app/workspace/layout.tsx` -- pattern for `RequireAuth` wrapper; `/admin` gets its own layout.
- `apps/web/src/components/ui/{input,label,textarea,badge,button,table}.tsx`, `sonner` -- reuse for the form.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/lib/server/guard.ts` + `guard.test.ts` -- `isAdminPrincipal`, reuse in `requireAdmin`
- [ ] `apps/web/src/lib/server/me-entitlements.ts` + test -- `isAdmin` field
- [ ] `apps/web/src/lib/server/db.ts`, `admin-users.ts` + tests -- `lastChange`
- [ ] `apps/web/src/lib/use-entitlements.ts` -- client hook returning `{ isAdmin, loading }`
- [ ] `apps/web/src/components/admin/admin-nav-link.tsx` + header wiring in `workspace/page.tsx`
- [ ] `apps/web/src/app/admin/layout.tsx`, `page.tsx`, `apps/web/src/components/admin/{users-panel,override-dialog}.tsx` -- page, search, rows, dialog, audit line
- [ ] `apps/web/src/components/ui/dialog.tsx` -- sheet variant below `md`, title focus
- [ ] pure helpers (`confirmationText`, `endOfLocalDayIso`) in `apps/web/src/lib/admin-override.ts` + test

**Acceptance Criteria:**
- Given a signed-in admin, when they open the workspace, then an Admin item appears; given a non-admin, then it never renders and `/admin` shows the standard not-found.
- Given the admin searches "najran", then matching users list email, current plan and expiry.
- Given Pro and a future date, when submitted and confirmed, then the exact confirmation text was shown, the row updates and the audit line (admin, time) appears under it.
- Given the confirmation opens, then focus is on the title, `Esc` closes it, it is a bottom sheet below `md`, targets are ≥44px and 320px has no horizontal scroll.
- Given `npm test` and `npx tsc --noEmit` in `apps/web`, then both pass and existing behavior is unchanged.

## Implementation Notes

Demo principal gets `isAdmin: false` (follows the manual check); `requireAdmin` still admits demo. Dialog close button made 44px globally. No browser/UI run performed; mocks only, no AI calls.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| audit query runs with empty ids | false | `listUsersWithPlans` returns early when `matched` is empty |
| order/subject_user_id not asserted in db test | medium | patched: assertions added |
| stale isAdmin on user switch | low | patched: state reset at effect start |
| VALIDATION with unknown field closes dialog silently | medium | patched: toast fallback |
| audit `.limit(5000)` vs PostgREST max-rows | medium (unverified) | deferred |
| 50-user cap not signalled in UI | low | deferred |
| no UI component tests | medium | deferred (no harness) |
| demo principal isAdmin false vs requireAdmin allows demo | false | follows spec manual check; documented |
| double-submit, timezone, max date, optimistic lastChange, dialog close size, stale rows on failed search, config-swallow log | low | rejected: unlikely, fix adds complexity |

## Design Notes

`lastChange` reads `audit_log` (service role only; no browser policy). Admin visibility is a UX hint: the API guard is the real gate, which is why a stale `isAdmin` can at worst show a link that 403s.

## Verification

**Commands:**
- `cd apps/web && npm test` -- expected: all pass, incl. existing migration grep tests
- `cd apps/web && npx tsc --noEmit` -- expected: no errors

**Manual checks (if no CLI):**
- With `ALLOW_DEMO` and no allowlist, `/admin` shows not-found; at 320px width the page does not scroll horizontally. (Local `next dev` may need the Node 25 tailwind workaround in AGENTS.md.)
