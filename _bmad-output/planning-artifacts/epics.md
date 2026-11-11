---
status: final
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-ai-procurement-subscriptions-2026-11-11/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-AI PROCEDUREMENT -2026-11-11/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-AI PROCEDUREMENT -2026-11-11/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-AI PROCEDUREMENT -2026-11-11/EXPERIENCE.md
---

# AI PROCUREMENT - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for AI Procurement Analyzer — Subscriptions, Manual Payment & Turnstile, decomposing the requirements from the PRD, UX Design and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Every new and existing user has the Free Plan unless an active Paid Plan applies; when a Paid Plan's expiry passes the user returns to Free automatically (computed per request, no manual step). Data created on a Paid Plan (analyses, tender sheets) is retained after fallback.
FR2: The system counts each newly uploaded Quotation PDF against the user's PDF Quota for the current Quota Period and blocks uploads server-side once used up (Free 15th PDF in a month blocked, 14th succeeds). Blocked uploads show limit reached, Plan, reset date, and a link to Plans. Re-analysis of already-uploaded PDFs costs nothing; an upload counts only once extraction succeeds; a multi-PDF batch exceeding remaining Quota is rejected whole, showing the number remaining.
FR3: Free usage resets on the calendar month (Asia/Riyadh boundary); Paid Plan usage resets every 30 days from activation (D, D+30, D+60…). Early same-plan renewal adds a full 30-day period after the current one without resetting current usage; an upgrade begins a fresh Period with zero usage.
FR4: Only Plus, Pro and Max can use the chatbox. Free users see the entry point locked with an upgrade prompt and the chat API returns a clear "plan required" error. No per-message cap.
FR5: Only Pro and Max can use the tender sheet (fill and export). Free and Plus see it locked with an upgrade prompt and its API routes return "plan required".
FR6: Users can see current Plan, expiry (Paid only), "X of Y PDFs used", next reset date, and compare Plans with USD prices; the usage figure matches the count enforced by FR2.
FR7: A signed-in user can choose Plus, Pro or Max and see bank details and the exact USD amount. Bank details and prices come from configuration, not source. USD only. Page states the ~24h review expectation and the refund policy (no refunds once activated; unverifiable payments → contact Support Address, manual refund outside the system).
FR8: A signed-in user can submit a Payment Request (Plan, screenshot PNG/JPG/PDF ≤5 MB, transaction ID) protected by Turnstile. Missing fields give field-level errors; screenshot stored privately (viewable only by submitter and Admins); success shows "Pending review" and a history entry; a duplicate transaction ID is flagged to the Admin, not auto-rejected; one Pending Request per user at a time; Admin is emailed for every new request.
FR9: A user on a Paid Plan can pay early for the same Plan to extend it: approved early payment sets expiry to current expiry + 30 days; paying after expiry starts a new 30-day Period from approval time.
FR10: Plans rank Plus < Pro < Max. An approved higher-Plan request starts immediately with fresh 30 days and fresh Quota (remaining days of the previous Plan forfeited, no proration). An approved lower-Plan request is queued and starts at current Plan's expiry (paid at request time). The Plans page shows any queued Plan and its start date.
FR11: An Admin can list, inspect, approve and reject Payment Requests on the Admin Page. Page accessible only to `ADMIN_EMAILS` (server-side enforced, else 403/redirect); pending list oldest-first showing user email, Plan, USD amount, transaction ID, submitted time, duplicate flag and viewable screenshot; approve activates/extends per FR9/FR10 in one action; reject requires a typed reason; every decision records who and when; decided requests stay in a history view and cannot be decided again.
FR12: Approving a Payment Request activates the Plan for 30 days (or per FR9/FR10); the user's next request sees the new Plan and Quota with no re-login.
FR13: The user is emailed via Resend on approve (Plan and expiry date) and reject (Admin's reason and how to resubmit). Email failure does not roll back the decision; the failure is logged and visible to the Admin.
FR14: The Admin is emailed on each new Payment Request (user, Plan, amount, link to Admin Page). Users are emailed once, 3 days before a Paid Plan expires (not sent if already renewed beyond that window); a scheduled job runs at least daily.
FR15: An Admin can set any user's Plan and expiry directly without a Payment Request (e.g., Najran pilot users on Pro free). Takes effect immediately, falls back to Free at expiry, and is recorded in the audit trail with Admin and time.
FR16: When a Paid Plan expires the user returns to Free with no manual step; if a queued lower Plan exists it starts instead. Free usage starts from 0 for the rest of that calendar month; only PDFs uploaded after the expiry moment count toward Free Quota.
FR17: Signup, login, password reset and the payment form each render Turnstile and require a valid token, verified server-side (missing, invalid, expired or reused tokens rejected). Rejections show a clear retryable message and reset the widget.
FR18: If Turnstile verification cannot be completed (unreachable, timeout, misconfigured secret) the submission is rejected ("verification unavailable, try again") on all four forms; failure is logged without secrets or tokens.
FR19: Max users get email replies from the founder within 12 hours, others within 48 hours. The Plans page states the targets and shows the Support Address; the Admin Page shows each user's current Plan for triage. No ticketing or in-app support form in v1.

### NonFunctional Requirements

NFR1: Plan checks add no more than 100 ms (p95) to gated requests.
NFR2: Payment screenshots are stored in a private bucket with access controlled by row-level rules; no public URLs.
NFR3: Payment screenshots are retained 12 months after submission and then deleted automatically; the Payment Request record (Plan, transaction ID, decision, timestamps) is kept.
NFR4: All outbound email uses the sender from the `EMAIL_FROM` configuration so the domain can change without a code change.
NFR5: Turnstile site key and secret come from environment configuration; the secret is never exposed to the client.
NFR6: The Turnstile widget works on mobile browsers and is keyboard-accessible.
NFR7: Bank details, prices, Support Address and other deployment values are configuration, not hard-coded.
NFR8: Success targets (operational): review turnaround under 24h for 90% of requests (SM-2); do not tighten CAPTCHA at the cost of blocking real buyers on slow networks (SM-C2); pilot users must not lose analyses to quota blocks (SM-C3).
NFR9: Existing extraction, scoring, TA form, report and Excel export behavior must not change (non-goal / regression constraint).

### Additional Requirements

- **Starter template:** none — brownfield feature work inside live `apps/web` (Next.js 15 App Router, Supabase, Vercel). No starter-template story.
- AD-1: Server-verified identity. Single client helper `apiFetch` attaches `Authorization: Bearer <access_token>` to all `/api/*` calls. `requirePrincipal` verifies via `supabase.auth.getUser`. Every `route.ts` carries a `// guard: <class>` marker (`jwt`, `feature:chat`, `feature:tender_sheet`, `admin`, `apikey`, `token-link`, `cron`, `public`) enforced by a test. Route-class table for existing and new routes (`doc-answer` gated as chat; `approve`/`dashboard` stay token-link). Demo mode: synthetic Max principal only when Supabase env absent and not production; production with missing config returns 503.
- AD-2: API-key principal for the Fastn intake workflow. `api_keys` table (SHA-256 only; raw key shown once), accepted only on `apikey`-class routes (`/api/extract`), same quota path, one key per user, admin-only creation/revocation route (`POST /api/admin/api-keys`, no UI), service-role helpers only.
- AD-3: Entitlement is an append-only, non-overlapping `plan_periods` ledger (`btree_gist` exclusion constraint, `voided_at` only mutation). `effectivePlan(periods, now)` TS reader, `plan_chain_end(user)` SQL writer helper, shared fixture `lib/entitlements/cases.json` testing both. Payment periods 30 days; non-upgrade appends at chain end; upgrade voids current and re-chains queued periods; admin override voids all future/current and inserts one period. Quota/feature matrix only in `lib/entitlements/plans.ts`. No cron needed for expiry.
- AD-4: One server-side check per request, no cross-request caching. `requireFeature(req, 'chat'|'tender_sheet')` returns 403 `PLAN_REQUIRED` with `{feature, requiredPlan}`. UI learns plan only from `GET /api/me/entitlements` (plan, expiry, ordered `queued` list, used, quota, reset date).
- AD-5: Quota via Postgres reserve/confirm/release: `quotaWindow(periods, now)` single window definition (Riyadh time confined to `lib/entitlements/`); table `pdf_usage`; `reserve_pdf_quota` with per-user lock, `STALE` handling, dedupe by file hash (re-analysis free), whole-batch 429 `QUOTA_EXCEEDED`; `confirm_pdf_usage` / `release_pdf_usage` per file; PR file never counted; enforced only in `/api/extract`.
- AD-6: `payment_requests` and `audit_log` tables; partial unique index (one pending per user, 409 `PENDING_REQUEST_EXISTS`); non-unique `transaction_id` index with duplicate flag derived at read; `decide_payment_request`, `admin_set_plan`, `reserve_pdf_quota` all take the same `pg_advisory_xact_lock`; 409 `ALREADY_DECIDED`; `amount_usd` copied from config at submission; audit rows written in-transaction.
- AD-7: `requireAdmin` requires email in `ADMIN_EMAILS` AND user id in `ADMIN_USER_IDS` (empty in production → every admin request 403). `/api/admin/*` all call `requireAdmin`; Admin Page shows each user's current plan.
- AD-8: Private bucket `payment-proofs` (path `<user_id>/<request_id>.<ext>`, no anon/authenticated storage policy). `POST /api/payments` multipart order: guard → Turnstile → validate (plan, txn id, magic-byte file type, ≤5 MB) → upload (service-role) → insert; cleanup object on pre-commit failure. 60-second signed URLs after ownership/admin check. Retention job deletes >12-month objects and nulls `screenshot_path`. `GET /api/billing/config` is the only path for plans/bank data; `BANK_DETAILS` and `PLAN_PRICES_USD` never `NEXT_PUBLIC_*`.
- AD-9: Turnstile native (Supabase CAPTCHA via `options.captchaToken`) for signup, login, password reset; single custom verifier `lib/server/turnstile.ts` for payment (5s timeout; 503 `CAPTCHA_UNAVAILABLE` on timeout/network/secret/`internal-error`; 400 `CAPTCHA_FAILED` on missing/invalid/duplicate; never fail open; no token/secret in logs; widget resets each attempt). Site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- AD-10: `lib/server/email.ts` `sendEmail(template, to, data)` over a closed template set (`payment_submitted_admin`, `payment_approved`, `payment_rejected`, `expiry_reminder`); post-commit, best-effort; Resend `{data,error}` checked; every attempt logged in `email_log`; failure visible on Admin Page; admin notifications to all `ADMIN_EMAILS`.
- AD-11: `GET /api/cron/daily` (Bearer `CRON_SECRET`, `dynamic = 'force-dynamic'`), Vercel Cron once/day in `vercel.json`, idempotent tasks: expiry reminders (claimed via unique `(template, subject_id)` `email_log` row) and screenshot retention deletion; never mutates `plan_periods`; production deployments only.
- AD-12: New tables with RLS (users `select` own rows of `plan_periods`, `payment_requests`, `pdf_usage` only; no write policies); all new functions revoke execute from public/anon/authenticated, grant to `service_role`, fixed `search_path` (migration grep test); all writes via service-role client in `lib/server/db.ts`; import-boundary test (nothing outside `lib/server/` and `lib/entitlements/` imports `lib/server/*`); migrations `0005_*.sql` onward only, idempotent, never edit existing files; `timestamptz` UTC, uuid ids, integer USD money.
- Conventions: error shape `{ "error", "code", ...}` with the defined code set (`UNAUTHENTICATED`, `FORBIDDEN`, `PLAN_REQUIRED`, `QUOTA_EXCEEDED`, `PENDING_REQUEST_EXISTS`, `ALREADY_DECIDED`, `CAPTCHA_FAILED`, `CAPTCHA_UNAVAILABLE`, `VALIDATION`); `lib/server/config.ts` sole `process.env` reader for new features, validates once, fails closed in production; new env vars documented in `.env.example` only (`ADMIN_EMAILS`, `SUPPORT_EMAIL`, `BANK_DETAILS`, `PLAN_PRICES_USD`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_USER_IDS`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`); all entitlement functions take `now: Date`; fake suppliers/users only in fixtures, never Najran data.
- Required tests in `npm test`: `cases.json` entitlement fixtures; route guard markers; import boundary + `revoke execute` grep; Turnstile verifier with mocked fetch incl. timeout; `sendEmail` with Resend error response. SQL side of `cases.json` run by hand in Supabase SQL editor before deploys changing `0005+`. `npm test` and `npx tsc --noEmit` before every commit (AGENTS.md).
- New dependency: `resend` 6.38.0.
- Rollout order: (1) apply `0005`, bucket, `btree_gist`, run SQL fixtures; (2) set env vars, verify Resend sending domain; (3) mint Fastn API key and make intake workflow send `X-Api-Key` (do not edit `workflow.json` from here); (4) deploy web code; (5) seed pilot users on Pro via `admin_set_plan`; (6) enable Supabase CAPTCHA only after widget code is deployed, smoke-test signup/login/reset and Cloudflare-unreachable; (7) add `crons` to `vercel.json`, set `CRON_SECRET`.
- Existing gating targets: `api/extract`, `api/chat`, `api/doc-answer`, `api/tender-sheet/{fill,export}`, `ta-form/export-excel`; UI `chat-panel.tsx`, `tender-sheet-dialog.tsx`. Existing `analysis-engine.ts`, `extraction-server.ts`, `approval-form-*` stay untouched.
- Deferred (not in scope): `POST /api/dashboard` hardening, API-key admin UI, `/api/intake` rate limiting, staging/CI, multi-admin/roles/org accounts/card payments/SAR/analytics.

### UX Design Requirements

UX-DR1: Usage meter in the header (right of nav, left of user menu): "{used} / {quota} PDFs used this month" (Paid: "this period"), 6px bar ~96px wide at `md+`; below `md` text-only with bar beneath at full width, never hidden; whole meter links to Plans; fill primary, ≥80% warning tint, 100% danger tint (passive tint only, no popup/toast); `role="progressbar"` with aria-valuemin/max/now and accessible name equal to visible text; never animates; skeleton while loading (never "0 / 0").
UX-DR2: Upgrade callout inline in the workspace upload zone, shown only after a blocked upload: single-sentence what happened + what to do, primary "See plans" and equal-standing ghost "Not now"; dismissal lasts the page session; shows plan, reset date. Batch-exceeds variant: "You selected {n} PDFs but have {r} left. Remove {n−r} or see plans."
UX-DR3: Locked-feature control for Chatbox and Tender sheet (fill/export): always visible, muted with Lock icon and an outline badge naming the plan needed, always clickable, opens Locked-feature dialog (`max-w-md`: feature name, minimum plan, one-line benefit, "See plans" primary + "Close"); never auto-opens; also shown if a stale client receives `PLAN_REQUIRED`.
UX-DR4: Plans page: current plan name, expiry (Paid), "X of Y PDFs used", reset date, queued-plan info block ("{LowerPlan} starts on {date}. You keep {CurrentPlan} until then."), expiring-≤3-days info alert, one-time expired alert, plan cards grid (4 cols `lg`, 2 `sm/md`, 1 below), no preselected or promoted card (no "Most popular"), current card with 2px primary border and "Current plan" badge, one button per card ("Choose {plan}" / disabled "Current plan"), Check/Lock feature rows, price figure with "/ month".
UX-DR5: Plan comparison matrix table (rows: PDFs per month, Chatbox, Tender sheet, Priority Support with 12h/48h targets, Price); on `<md` "Compare plans" expands as stacked cards; Plans page also shows the Support Address.
UX-DR6: Pay step (`max-w-2xl` centered): heading "Pay $X.00 USD by bank transfer", bank-details card (muted fill, `rounded-xl`) with label-over-value rows, a Copy button per value (accessible name "Copy IBAN", 44px on mobile, inline "Copied" for 2s + polite live-region, no toast), IBAN grouped in fours, amount in `figure` as the largest text; 3-step instructions; refund policy in plain words, review-time expectation, upgrade-forfeiture and downgrade-timing disclosures above the submit button; one primary "Submit payment proof"; card renders whatever fields config supplies.
UX-DR7: Proof upload field: dashed dropzone matching existing upload-zone language, drag-and-drop desktop / tap-to-choose with camera and gallery on mobile, one file only, PNG/JPG/PDF ≤5 MB with immediate per-field inline errors stating the limit, preview or filename+size with Remove, progress indicator, retry message on network failure ("Upload didn't finish. Your details are kept. Try again."), never double-submits, keeps form values and chosen file on errors.
UX-DR8: Payment pending/approved/rejected states: pending banner ("Payment under review — submitted {time}…") with other plan choices disabled and reason stated; status badge component (Pending=warning+Clock, Approved=success+CheckCircle2, Rejected=danger+XCircle) using `bg-{token}/10 text-{token}` with `dark:` pairing (must not copy the hardcoded existing `Badge`); status never color alone and read as text.
UX-DR9: Payment history on Plans page (paginated, no infinite scroll): date, plan, USD amount, status badge; Rejected rows expand to show reason and a "Submit a new request" action.
UX-DR10: Admin Queue: oldest-first request cards (user email, plan, expected USD amount, transaction ID, submitted time, duplicate warning alert with link, screenshot thumbnail), full-screen screenshot viewer (pinch/zoom on mobile, alt text "Payment receipt submitted by {user}", keyboard closable, PDF "Open in new tab" fallback), equal-size Approve (primary) and Reject (outline, danger text, never filled red) at 44px targets, `lg` two-pane layout (list left, selected request right), single column on mobile ordered facts → screenshot → actions, `Enter` opens a card and `Esc` closes viewer/confirmation, empty state "No payments waiting.", already-decided state shows decision and who/when and stale action returns "This request was already decided."
UX-DR11: Decision confirmation surface (Dialog on `md+`, bottom sheet `rounded-t-2xl` with safe-area padding below `md`, one dialog open at a time): Approve restates user, plan, amount and resulting expiry date with focus on dialog title (not auto-focused confirm); Reject has required reason textarea with hint "This text is emailed to the user" and disabled button until non-empty.
UX-DR12: Admin History tab (decided requests, who/when, "Email not sent" warning badge when email failed) and Admin Users tab (search, current plan per user for support triage, manual override form: plan, expiry date, optional note, confirmation text "Sets {Plan} until {date}, effective immediately. Falls back to Free at expiry. Recorded in the audit log." with audit entry shown after).
UX-DR13: Admin navigation item visible only to allowlisted admins; non-admin hitting admin routes gets the standard redirect/not-found (never an "access denied" page).
UX-DR14: Turnstile widget on signup, login, password reset and payment form: managed size inside the form under the last field and above submit, reserved height (no layout jump), submit disabled until token, on rejection show "Verification failed. Please try again." (unreachable: "Verification is unavailable right now. Please try again in a moment."), reset widget, preserve form data, return focus to widget with announcement, never block keyboard focus order.
UX-DR15: Voice and tone rules: plain specific copy with numbers and dates (`11 Dec 2026`), amounts `$12.00 USD` on first mention in payment context, no urgency/scarcity language, no emoji, no exclamation marks in money/limit contexts, no dark patterns; prompts only on a blocked upload or locked-control click; extraction-failed results add "This didn't use any of your PDFs."
UX-DR16: Accessibility floor WCAG 2.2 AA: visible Label on every field, errors linked via `aria-describedby` and focus to first invalid field, `aria-live="polite"` for status changes and `role="alert"` for errors, dialogs trap/restore focus, targets ≥44px on Pay step and Admin, 200% text resize, no horizontal scroll at 320px, `prefers-reduced-motion` respected.
UX-DR17: Design tokens: no new brand colors/fonts — use existing CSS variable tokens by name (primary, warning, danger, success, muted), tabular numerals (`.nums`) on all prices, amounts, IBANs, transaction IDs, counts and dates; dark-mode variants for all new components.
UX-DR18: Responsive behavior: breakpoints per EXPERIENCE (≥lg 4-col plans + admin two-pane, md 2-col plans + single-col admin, <md stacked with hamburger sheet and meter staying outside it); phone-first verification for Pay step and Admin; Chrome and Safari incl. iOS Safari.

### FR Coverage Map

FR1: Epic 1 - Free default, effective-plan computation
FR2: Epic 2 - Quota enforcement on `/api/extract` (incl. Fastn API-key principal)
FR3: Epic 2 - Quota periods and windows
FR4: Epic 3 - Chatbox gating
FR5: Epic 3 - Tender sheet gating
FR6: Epic 2 - Usage meter, entitlements endpoint, Plans page (plan, usage, matrix)
FR7: Epic 4 - Plan selection, bank details, policies
FR8: Epic 4 - Payment request submission, private screenshot, history
FR9: Epic 4 - Renewal / early payment
FR10: Epic 4 - Upgrade / queued downgrade
FR11: Epic 4 - Admin review queue and history
FR12: Epic 4 - Approval activation
FR13: Epic 4 - Decision emails to user
FR14: Epic 4 (admin notification) + Epic 6 (3-day expiry reminder)
FR15: Epic 1 - Admin manual plan override (pilot grant)
FR16: Epic 1 (fallback to Free) + Epic 4 (queued lower plan starts at expiry)
FR17: Epic 5 - Turnstile on four forms
FR18: Epic 5 - Fail closed
FR19: Epic 2 - Support targets on Plans page; Admin plan column in Epic 1

## Epic List

Epics follow the architecture spine's rollout order (steps 1–7), so each epic is shippable and safe to deploy before the next.

### Epic 1: Verified Identity, Plan Ledger & Pilot Grants
The founder can see every user's plan and grant plans manually (Najran pilot on Pro) on a server-verified, auditable entitlement ledger; every user is Free by default and falls back to Free on expiry. Covers rollout steps 1, 2 and 5: migration `0005`, bucket, env/config, Resend domain, `requirePrincipal`/`requireAdmin`/`apiFetch`, route guard markers, `admin_set_plan`, Admin Users tab.
**FRs covered:** FR1, FR15, FR16 (Free fallback), FR19 (Admin plan column)
**Also covers:** NFR4, NFR7; AD-1, AD-3, AD-4 (core), AD-6 (`admin_set_plan`), AD-7, AD-12; UX-DR12 (Users tab), UX-DR13

### Epic 2: Plan Quotas, Usage Visibility & Fastn Continuity
Users see their plan and PDF usage at all times and uploads are limited per plan, without breaking the live Fastn intake workflow. Covers rollout step 3 and the quota half of step 4: API-key principal, `reserve/confirm/release_pdf_quota`, `/api/extract` enforcement, header meter, upgrade callout, Plans page (current plan, usage, matrix, support targets).
**FRs covered:** FR2, FR3, FR6, FR19
**Also covers:** NFR1; AD-2, AD-5; UX-DR1, UX-DR2, UX-DR4, UX-DR5, UX-DR15, UX-DR17, UX-DR18

### Epic 3: Feature Gating for Chatbox & Tender Sheet
Plus/Pro/Max users get the chatbox and Pro/Max get the tender sheet; others see clear, clickable locked states with an upgrade path.
**FRs covered:** FR4, FR5
**Also covers:** AD-1 (feature classes, `doc-answer`), AD-4 (`requireFeature`); UX-DR3

### Epic 4: Pay by Bank Transfer & Admin Review
A user can choose a plan, pay by bank transfer, submit proof and get a decision by email; the founder reviews and approves/rejects from a mobile-friendly queue, with renewals, upgrades and queued downgrades handled correctly.
**FRs covered:** FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14 (admin notification), FR16 (queued plan)
**Also covers:** NFR2, NFR3 (storage side), NFR4; AD-6, AD-8, AD-10; UX-DR6–UX-DR11, UX-DR16

### Epic 5: Turnstile Bot Protection
Signup, login, password reset and the payment form reject bots and fail closed if verification is unavailable. Covers rollout step 6 (widget code deployed before enabling Supabase CAPTCHA, then smoke tests).
**FRs covered:** FR17, FR18
**Also covers:** NFR5, NFR6; AD-9; UX-DR14

### Epic 6: Expiry Reminders & Screenshot Retention
Paid users are emailed once, 3 days before expiry, and payment screenshots are deleted after 12 months. Covers rollout step 7: `/api/cron/daily`, `vercel.json` crons, `CRON_SECRET`.
**FRs covered:** FR14 (reminder)
**Also covers:** NFR3 (deletion job); AD-11

## Epic 1: Verified Identity, Plan Ledger & Pilot Grants

The founder can see every user's plan and grant plans manually on a server-verified, auditable entitlement ledger; every user is Free by default and falls back to Free on expiry.

### Story 1.1: Server-verified identity and route guard markers

As the founder,
I want every API route to verify the caller's identity on the server and declare a guard class,
So that no route trusts a plan, user id or admin flag sent by the browser.

**Acceptance Criteria:**

**Given** the browser holds a Supabase session
**When** any client code calls `/api/*` through `apiFetch`
**Then** the request carries `Authorization: Bearer <access_token>`
**And** `requirePrincipal` verifies it with `supabase.auth.getUser` and returns `{ userId, email, via: 'jwt' }`.

**Given** a request with a missing or invalid token to a `jwt`-class route
**When** the route runs
**Then** it returns 401 `{ error, code: 'UNAUTHENTICATED' }`.

**Given** every `route.ts` under `apps/web/src/app/api`
**When** `npm test` runs
**Then** each carries a `// guard: <class>` marker from the valid AD-1 class set
**And** `ta-form/export-excel` is interim `public` (the Fastn intake workflow calls it unauthenticated; Story 2.1 moves it to `apikey`), `approve`/`dashboard` are `token-link`, `fx`/`intake` are `public`
**And** `extract`, `chat`, `doc-answer` and `tender-sheet/*` keep their current behavior and carry an interim `public` marker that Stories 2.1 (`apikey`) and 3.1 (`feature:chat` / `feature:tender_sheet`) replace
**And** the test fails if a marker is missing, is not a valid class, or disagrees with the helper actually called.

**Given** the existing `approve`/`dashboard` token links and public `fx`/`intake` routes
**When** the change ships
**Then** their behavior is unchanged (NFR9).

**Given** Supabase env is absent and `NODE_ENV !== 'production'`
**When** a guarded route runs
**Then** the guard returns a synthetic Max principal
**And** in production the same condition returns 503 and never a principal.

**Given** new features read configuration
**When** `lib/server/config.ts` loads
**Then** it is the sole `process.env` reader, validates once, and fails closed in production
**And** `.env.example` documents all new variables (`ADMIN_EMAILS`, `SUPPORT_EMAIL`, `BANK_DETAILS`, `PLAN_PRICES_USD`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_USER_IDS`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) without editing any `.env*` file.

**Given** the import-boundary test
**When** any file outside `lib/server/` and `lib/entitlements/` imports `lib/server/*`
**Then** the test fails (AD-12).

### Story 1.2: Plan ledger, effective plan and entitlements endpoint

As a user,
I want my plan to be Free by default and computed correctly from my plan periods,
So that what I can do always matches what I'm entitled to.

**Acceptance Criteria:**

**Given** migration `0005_subscriptions.sql` (new file; existing migrations untouched)
**When** it is applied
**Then** it enables `btree_gist` and creates `plan_periods` and `audit_log` with RLS (users may select only their own `plan_periods` rows; no write policies)
**And** an exclusion constraint prevents overlapping non-voided periods per user and `ends_at > starts_at` is enforced
**And** it is idempotent like `0001`.

**Given** `lib/entitlements/plans.ts`
**When** reviewed
**Then** it is the only place defining quota (14/30/45/100), chatbox and tender-sheet access and plan rank, with no I/O or env access.

**Given** `effectivePlan(periods, now)`
**When** a user has no period, an expired period, a voided period, or an active period
**Then** it returns Free, Free, Free, and the active plan respectively
**And** all cases pass from the shared `lib/entitlements/cases.json` (FR1, FR16).

**Given** a Paid Plan's `ends_at` has passed and no queued period exists
**When** the user makes their next request
**Then** they are treated as Free with no manual step and no job, and prior data is retained.

**Given** a signed-in user
**When** they call `GET /api/me/entitlements` (guard: jwt)
**Then** the response contains plan, expiry, ordered `queued` list, and (placeholder zero until Epic 2) used/quota/reset fields
**And** the plan is never cached in memory, cookie, JWT or `user_metadata`.

**Given** a new function created in `0005`
**When** the migration grep test runs
**Then** every `create function` revokes execute from `public`, `anon`, `authenticated`, grants only `service_role`, and sets a fixed `search_path`.

### Story 1.3: Admin identity and manual plan override API

As the founder,
I want to set any user's plan and expiry without a payment,
So that I can grant the Najran pilot users Pro free of charge.

**Acceptance Criteria:**

**Given** `requireAdmin`
**When** the caller's lower-cased email is in `ADMIN_EMAILS` and their user id is in `ADMIN_USER_IDS`
**Then** access is allowed
**And** in production an empty `ADMIN_USER_IDS` makes every admin request 403 `FORBIDDEN`.

**Given** `admin_set_plan(user_id, plan, ends_at, admin_email)` (service_role-only, takes the AD-6 per-user advisory lock)
**When** called with `ends_at > now`
**Then** it voids every non-voided period with `ends_at > now`, inserts one `source='admin'` period starting now, and writes an `audit_log` row in the same transaction (FR15).

**Given** a period set by override
**When** `ends_at` passes
**Then** the user falls back to Free like any Paid Plan.

**Given** `POST /api/admin/users` and `GET /api/admin/users?search=` (guard: admin)
**When** a non-admin calls them
**Then** they get 403, and for admins the acting identity comes from the principal, never the body
**And** the GET returns each matching user with their current plan and expiry (FR19 triage).

**Given** an `ends_at` in the past or an unknown plan
**When** submitted
**Then** it returns 400 `VALIDATION` with `fields`.

### Story 1.4: Admin Users tab with manual override

As the founder,
I want an Admin Users page where I can find a user and set their plan,
So that I can grant and review plans without touching SQL.

**Acceptance Criteria:**

**Given** a signed-in admin
**When** they view the app navigation
**Then** an Admin item appears; non-admins never see it
**And** a non-admin visiting `/admin` gets the standard redirect/not-found, not an "access denied" page (UX-DR13).

**Given** the Admin Users tab
**When** the admin searches "najran"
**Then** matching users are listed with email, current plan and expiry.

**Given** a selected user
**When** the admin picks Pro, sets an expiry date and optional note and submits
**Then** a confirmation reads "Sets Pro until {date}, effective immediately. Falls back to Free at expiry. Recorded in the audit log."
**And** on confirm the row updates and the audit entry (admin, time) appears under it (UX-DR12, Flow 3).

**Given** the confirmation is a Dialog on `md+` and bottom sheet below `md`
**When** it opens
**Then** focus lands on the dialog title, `Esc` closes it, only one dialog is open at a time, targets are ≥44px and the page does not scroll horizontally at 320px (UX-DR16, UX-DR18).

### Story 1.5: Deploy the foundation and seed the pilot on Pro

As the founder,
I want the schema, configuration and pilot grants applied in the spine's rollout order,
So that the Najran pilot users never see a limit before limits exist.

**Acceptance Criteria:**

**Given** rollout steps 1–2
**When** the founder follows the written runbook committed in this story
**Then** `0005` is applied, the `payment-proofs` bucket is created, `btree_gist` is enabled and the SQL side of `cases.json` is run by hand in the Supabase SQL editor with all cases passing
**And** env vars are set per `.env.example` and the Resend sending domain verification status is recorded as a pre-launch checklist item (real payments are not accepted until verified).

**Given** rollout step 5
**When** pilot users are seeded through `admin_set_plan`
**Then** each is on Pro with an expiry before any quota is visible to them (SM-C3)
**And** no Najran supplier data is used in any fixture or demo.

**Given** `npm test` and `npx tsc --noEmit`
**When** run before commit
**Then** both pass (AGENTS.md).

## Epic 2: Plan Quotas, Usage Visibility & Fastn Continuity

Users see their plan and PDF usage and uploads are limited per plan, without breaking the live Fastn intake workflow.

### Story 2.1: API-key principal for the Fastn intake workflow

As the founder,
I want the Fastn intake workflow to authenticate with a per-user API key,
So that email-intake uploads are attributed to a user and counted against their quota.

**Acceptance Criteria:**

**Given** migration `0006_api_keys.sql` creating `api_keys(id, user_id, key_sha256, label, created_at, revoked_at)` with RLS and no user policy
**When** applied
**Then** it is idempotent and the table stores only the SHA-256 of keys.

**Given** `POST /api/admin/api-keys` (guard: admin)
**When** an admin creates a key for a user
**Then** the raw key is returned once and never stored or logged
**And** revocation sets `revoked_at`.

**Given** `/api/extract` (guard: apikey)
**When** called with a valid `X-Api-Key` or a valid JWT
**Then** the principal is `{ userId, via: 'api_key' | 'jwt' }`
**And** a revoked or unknown key returns 401 `UNAUTHENTICATED`.

**Given** `/api/ta-form/export-excel`, which the Fastn intake workflow (`wf_0b74a5ed061d`) calls with no credentials and which Story 1.1 leaves as interim `public`
**When** this story ships
**Then** the route is marked `apikey` and accepts a valid JWT or `X-Api-Key`, so Fastn can call it once the workflow sends the key
**And** the route is switched only after the Fastn workflow sends `X-Api-Key` on that call (rollout step 3), never before.

**Given** `X-Api-Key` sent to any non-`apikey` route
**When** the route runs
**Then** the header is ignored and the request gets 401.

**Given** an api-key principal
**When** data is read or written
**Then** it uses service-role helpers taking `principal.userId`, never a user-scoped Supabase client (AD-2).

### Story 2.2: Quota windows and atomic quota functions

As a user,
I want my PDF usage counted exactly once per new file within the right window,
So that limits are fair and never burned by failures or races.

**Acceptance Criteria:**

**Given** `quotaWindow(periods, now)` in `lib/entitlements/`
**When** evaluated for Free, Paid, a Paid plan in its second cycle, and Free after a paid plan ended mid-month
**Then** it returns `{ periodId, plan, quota, windowStart, resetAt }` per AD-5 using Asia/Riyadh month boundaries only inside this module
**And** all cases pass from `cases.json` (FR3, FR16).

**Given** migration `0007_pdf_usage.sql` creating `pdf_usage` and functions `reserve_pdf_quota`, `confirm_pdf_usage`, `release_pdf_usage`
**When** applied
**Then** functions take the AD-6 per-user lock, privileges follow AD-12, and the table has RLS with own-row select only.

**Given** `reserve_pdf_quota(user, hashes, window_start, quota, expected_period_id)`
**When** the effective period id differs from `expected_period_id`
**Then** it returns `STALE`.

**Given** a batch with duplicate hashes, a hash with any prior `confirmed` row, and new hashes exceeding remaining quota
**When** reserving
**Then** in-batch duplicates and previously confirmed hashes cost nothing (re-analysis free)
**And** if new hashes exceed remaining quota the whole batch is rejected with `{ plan, quota, remaining, resetAt }`
**And** `reserved` rows older than 10 minutes do not count.

**Given** `confirm_pdf_usage` on an expired reservation
**When** called
**Then** it still succeeds.

### Story 2.3: Enforce quota on `/api/extract`

As a Free-plan buyer,
I want uploads blocked once my allowance is used and failed extractions not to count,
So that limits are predictable and fair.

**Acceptance Criteria:**

**Given** a Free user with 13 of 14 PDFs used this Riyadh month
**When** they upload one quotation PDF that extracts successfully
**Then** it succeeds and usage becomes 14
**And** a further new PDF returns 429 `QUOTA_EXCEEDED` with `{ plan, quota, remaining, resetAt }` (FR2).

**Given** a batch of 5 new PDFs with 1 remaining
**When** uploaded
**Then** the whole batch is rejected, nothing is counted, and `remaining` is returned.

**Given** extraction fails for a file
**When** the route finishes
**Then** `release_pdf_usage` is called for that file and it consumes no quota
**And** successes call `confirm_pdf_usage`.

**Given** a re-analysis of an RFQ whose PDFs were already uploaded
**When** submitted
**Then** no quota is consumed.

**Given** the purchase-requisition file and quotation files of any format
**When** uploaded
**Then** the PR file is never counted and every quotation file is counted.

**Given** a client that skips the UI check
**When** it posts directly
**Then** enforcement is still applied server-side
**And** the effective period changing mid-request is handled by recomputing once and retrying on `STALE`.

**Given** existing analysis and extraction logic
**When** the change ships
**Then** `analysis-engine.ts` and `extraction-server.ts` are unmodified (gating wraps in the route).

### Story 2.4: Usage figures and header usage meter

As a user,
I want to see how many PDFs I've used at any time,
So that I know my allowance before I hit a wall.

**Acceptance Criteria:**

**Given** `GET /api/me/entitlements`
**When** called
**Then** `used`, `quota` and `resetAt` come from `quotaWindow` and match the count enforced in `/api/extract` (FR6)
**And** the plan-check overhead is ≤100 ms p95 (NFR1, measured in a test or logged timing).

**Given** the header on every signed-in page
**When** rendered
**Then** it shows "{used} / {quota} PDFs used this month" ("this period" for Paid) between the nav and user menu, linking to Plans
**And** it exposes `role="progressbar"` with aria-valuemin/max/now and an accessible name equal to the visible text (UX-DR1).

**Given** usage ≥80% or 100%
**When** the meter renders
**Then** the fill tint is warning or danger respectively, with no popup, toast or animation.

**Given** the entitlement request is loading
**When** the meter renders
**Then** it shows a skeleton and never "0 / 0".

**Given** viewport `<md`
**When** the meter renders
**Then** it is text-only with the bar beneath at full width, outside the hamburger sheet, never hidden (UX-DR18).

### Story 2.5: Upgrade callout on blocked uploads

As a Free-plan buyer,
I want a clear explanation when an upload is blocked,
So that I know why and what to do next.

**Acceptance Criteria:**

**Given** a blocked upload with quota fully used
**When** the workspace upload zone receives `QUOTA_EXCEEDED`
**Then** an inline callout reads "You've used all {Y} PDFs on your {Plan} plan. Resets on {date}. See plans." with primary "See plans" and equal-standing "Not now" (UX-DR2)
**And** `{date}` is formatted like `1 Dec 2026`.

**Given** a batch exceeding remaining quota
**When** blocked
**Then** the callout reads "You selected {n} PDFs but have {r} left. Remove {n−r} or see plans."

**Given** "Not now" was clicked
**When** the page session continues
**Then** the callout stays dismissed until the next blocked attempt
**And** no dialog, toast or banner about upgrading appears at any other time (UX-DR15).

**Given** an extraction that fails
**When** results show the existing error
**Then** it adds "This didn't use any of your PDFs."

**Given** the callout
**When** used with a screen reader
**Then** it is announced via `role="alert"` and has no color-only meaning (UX-DR16).

### Story 2.6: Plans page — current plan, usage and comparison

As a user,
I want a Plans page showing my plan, expiry, usage, reset date and what each plan includes,
So that I know exactly what my plan allows.

**Acceptance Criteria:**

**Given** a signed-in user
**When** they open Plans from the meter or user menu
**Then** it shows plan name, "Active until {date}" (Paid only), "X of Y PDFs used" and the reset date (FR6, UX-DR4).

**Given** the plan matrix
**When** rendered
**Then** four plan cards (4 cols `lg`, 2 `sm/md`, 1 below) show USD price with "/ month", PDF quota and Check/Lock rows, current plan has a 2px primary border and "Current plan" badge, and no card is preselected or promoted
**And** USD prices are served from config via `GET /api/billing/config` (jwt), never `NEXT_PUBLIC_*` (NFR7).

**Given** the comparison view
**When** opened (stacked cards below `md` via "Compare plans")
**Then** rows are PDFs per month, Chatbox, Tender sheet, Priority Support (12h/48h targets) and Price, and the Support Address from config is shown (FR19, UX-DR5).

**Given** a Paid plan with ≤3 days left, or an expired plan the user has not yet been told about
**When** Plans loads
**Then** an inline info alert shows "Your {plan} plan ends on {date}. Renew to add 30 more days." or the one-time "Your {plan} plan ended on {date}. You're on Free. Your data is still here." with no popup.

**Given** tokens and tone
**When** reviewed
**Then** figures use `.nums`, only existing CSS tokens are used with dark-mode variants, and copy follows the voice rules (UX-DR15, UX-DR17).

**Given** this epic ships before payment exists
**When** a plan other than the current one is shown
**Then** its action button is not rendered yet (added in Epic 4) so no dead-end control exists.

## Epic 3: Feature Gating for Chatbox & Tender Sheet

Plus/Pro/Max users get the chatbox and Pro/Max get the tender sheet; others see clear, clickable locked states with an upgrade path.

### Story 3.1: Server-side feature gating

As the founder,
I want chat and tender-sheet endpoints to enforce plan access on the server,
So that paid features can't be reached by skipping the UI.

**Acceptance Criteria:**

**Given** `requireFeature(req, 'chat' | 'tender_sheet')`
**When** called
**Then** it runs `requirePrincipal`, loads non-voided periods with `ends_at >= now - 62 days` in one indexed query, and decides from `plans.ts`
**And** a denial returns 403 `PLAN_REQUIRED` with `{ feature, requiredPlan }`.

**Given** Free user
**When** calling `/api/chat` or `/api/doc-answer`
**Then** they get 403 `PLAN_REQUIRED` (`requiredPlan: 'plus'`)
**And** Plus, Pro and Max succeed with no message cap (FR4).

**Given** Free or Plus user
**When** calling `/api/tender-sheet/fill` or `/api/tender-sheet/export`
**Then** they get 403 `PLAN_REQUIRED` (`requiredPlan: 'pro'`)
**And** Pro and Max succeed (FR5).

**Given** a plan change took effect
**When** the user's next request arrives
**Then** access reflects it with no re-login or cache (AD-4)
**And** the guard markers for these routes are `feature:chat` / `feature:tender_sheet` and pass the marker test.

### Story 3.2: Locked-feature controls and dialog

As a Free-plan user,
I want to see the chatbox and tender sheet locked but visible,
So that I know they exist and which plan unlocks them.

**Acceptance Criteria:**

**Given** a user without access
**When** they view `chat-panel.tsx` or `tender-sheet-dialog.tsx` entry points
**Then** the control is shown muted with a Lock icon and an outline badge naming the plan needed ("Plus" / "Pro"), remains clickable, and is never hidden or red (UX-DR3).

**Given** the locked control is clicked
**When** the dialog opens
**Then** it shows feature name, minimum plan, one-line benefit, primary "See plans" and "Close", traps focus, restores it on close and closes on `Esc`
**And** it never opens automatically.

**Given** a stale client receives 403 `PLAN_REQUIRED`
**When** the response arrives
**Then** the same dialog is shown, branching on `code`, not message text.

**Given** a user with access
**When** the controls render
**Then** they behave exactly as before (NFR9).

## Epic 4: Pay by Bank Transfer & Admin Review

A user can choose a plan, pay by bank transfer, submit proof and get a decision by email; the founder reviews and decides from a mobile-friendly queue, with renewals, upgrades and queued downgrades handled correctly.

### Story 4.1: Choose a plan and see bank details

As a buyer whose company pays by bank transfer,
I want to choose a plan and see exactly what to transfer and where,
So that I can pay without a credit card.

**Acceptance Criteria:**

**Given** the Plans page
**When** a plan other than the current one is shown
**Then** it has a "Choose {plan}" button and the current plan shows a disabled "Current plan" (UX-DR4).

**Given** a chosen plan
**When** the Pay step (`max-w-2xl`, centered) opens
**Then** it shows "Pay ${amount}.00 USD by bank transfer", a muted bank-details card of label-over-value rows rendered from `BANK_DETAILS` config (whatever fields are supplied), the amount in the largest type, IBAN grouped in fours and `.nums` on all figures (FR7, UX-DR6, UX-DR17).

**Given** each bank value
**When** its Copy button (accessible name e.g. "Copy IBAN", 44px on mobile) is pressed
**Then** the value is copied and an inline "Copied" shows for 2s with a polite live-region announcement and no toast.

**Given** the page
**When** read before submit
**Then** it states the 3 steps, "typically within 24 hours", the refund policy in plain words with the Support Address, and — when applicable — the upgrade forfeiture ("remaining days not carried over") and downgrade timing, above the submit area.

**Given** changing config values
**When** `BANK_DETAILS` or `PLAN_PRICES_USD` change
**Then** the page updates with no code change and they are never exposed as `NEXT_PUBLIC_*`.

### Story 4.2: Payment request API and private screenshot storage

As a buyer,
I want to submit my payment proof securely,
So that it can be reviewed and nobody else can see it.

**Acceptance Criteria:**

**Given** migration `0008_payment_requests.sql`
**When** applied
**Then** it creates `payment_requests` with RLS (own-row select), a partial unique index allowing one `pending` row per user, a non-unique `transaction_id` index, and idempotent DDL.

**Given** `POST /api/payments` multipart (guard: jwt)
**When** a user submits plan, transaction ID and a file
**Then** the route validates plan, transaction ID, file type by magic bytes (PNG/JPG/PDF) and size ≤5 MB, uploads to private bucket `payment-proofs` at `<user_id>/<request_id>.<ext>` with the service-role client, then inserts the request with `amount_usd` copied from config (FR8)
**And** missing fields return 400 `VALIDATION` with field-level `fields`.

**Given** a failure before the row commits
**When** the route aborts
**Then** the uploaded object is removed.

**Given** the user already has a pending request
**When** they submit another
**Then** it returns 409 `PENDING_REQUEST_EXISTS`.

**Given** the same transaction ID exists on another request
**When** the new request is read by an admin
**Then** a derived duplicate flag is present, and the submission is not blocked.

**Given** `GET /api/payments` and `GET /api/payments/[id]/screenshot` (guard: jwt)
**When** the owner or an admin calls them
**Then** history is returned (paginated) and a 60-second signed URL is minted only after an ownership/admin check; others get 403
**And** no public URL, bank data or token is logged.

**Given** the payment form's Turnstile requirement
**When** this story ships
**Then** the route has a clearly marked hook point where Epic 5 adds verification; until then the feature is not exposed to real users (rollout order keeps Epic 5 before launch).

### Story 4.3: Pay form, pending banner and payment history

As a buyer,
I want to upload my receipt and see the status of my request,
So that I know it was received and what happens next.

**Acceptance Criteria:**

**Given** the Pay step
**When** the user drops or taps to choose a file
**Then** the dashed dropzone accepts one PNG/JPG/PDF ≤5 MB, shows preview or filename+size with Remove, and on mobile offers camera and gallery (UX-DR7)
**And** a wrong type or >5 MB shows an inline error stating the limit while keeping the typed transaction ID.

**Given** a valid form
**When** "Submit payment proof" is pressed
**Then** a progress indicator shows, the button cannot double-submit, and on success the page shows "Payment under review. Submitted {time}. We'll email you when it's decided." (UX-DR8)
**And** on network failure it shows "Upload didn't finish. Your details are kept. Try again."

**Given** server `VALIDATION`, `PENDING_REQUEST_EXISTS` errors
**When** returned
**Then** field-level errors link via `aria-describedby`, focus moves to the first invalid field and errors use `role="alert"` (UX-DR16).

**Given** a pending request
**When** the user views Plans
**Then** a banner states it is under review, other "Choose" buttons are disabled with "You can submit a new request once this one is decided."

**Given** Payment history
**When** rendered (paginated, no infinite scroll)
**Then** each row shows date, plan, USD amount and a status badge with word + icon (Pending=warning+Clock, Approved=success+CheckCircle2, Rejected=danger+XCircle) using `bg-{token}/10 text-{token}` with `dark:` pairing, not the hardcoded `Badge`
**And** Rejected rows expand to the reason and a "Submit a new request" action (UX-DR9).

**Given** phone width
**When** using the Pay step
**Then** targets are ≥44px, bank details come first then upload, and there is no horizontal scroll at 320px (UX-DR18).

### Story 4.4: Email module and admin new-request notification

As the founder,
I want an email whenever a payment request arrives,
So that I can review it quickly.

**Acceptance Criteria:**

**Given** migration `0009_email_log.sql` creating `email_log` with unique `(template, subject_id)` where required for reminders, RLS and no user policy
**When** applied
**Then** it is idempotent.

**Given** `lib/server/email.ts` with the new `resend` 6.38.0 dependency
**When** `sendEmail(template, to, data)` is called
**Then** only the closed templates `payment_submitted_admin`, `payment_approved`, `payment_rejected`, `expiry_reminder` are accepted, `EMAIL_FROM` is the sender (NFR4), and every attempt writes an `email_log` row
**And** a Resend response carrying `error` is recorded as failed and never throws or fails the HTTP request (tested with a mocked response).

**Given** a payment request row has committed
**When** the route finishes
**Then** every address in `ADMIN_EMAILS` is emailed the user, plan, amount and a link to the Admin Page (FR14)
**And** an email failure never removes the stored object or changes the request.

### Story 4.5: Decide payment requests — approve, reject, renew, upgrade, queue

As the founder,
I want approving or rejecting a request to apply the correct plan period atomically and notify the user,
So that payments turn into the right entitlement with one action.

**Acceptance Criteria:**

**Given** `decide_payment_request(request_id, admin_email, decision, reason)` (service_role-only, per-user advisory lock, audit row in the same transaction)
**When** an admin approves a request for a plan equal to or lower than the effective plan, or after expiry
**Then** it appends a 30-day period at `plan_chain_end` (same-plan early renewal = current expiry + 30 days; after expiry = starts now; lower plan queued to start at the previous expiry) (FR9, FR10, FR12).

**Given** an approval for a higher-ranked plan
**When** decided
**Then** it voids the current period, inserts the new plan starting now for 30 days with fresh quota, and re-chains not-yet-started paid periods after it keeping their length (remaining days of the current period forfeited).

**Given** the user's next request after approval
**When** it arrives
**Then** they see the new plan and quota with no re-login (FR12)
**And** the Plans page shows any queued plan: "{LowerPlan} starts on {date}. You keep {CurrentPlan} until then." and when a queued plan's predecessor expires it starts instead of Free (FR16).

**Given** a reject decision
**When** the reason is empty
**Then** it returns 400 `VALIDATION`
**And** with a reason the request becomes `rejected` with decider and time recorded.

**Given** an already decided request
**When** decided again
**Then** it returns 409 `ALREADY_DECIDED`.

**Given** `POST /api/admin/payments/[id]/decide` and `GET /api/admin/payments` (guard: admin)
**When** the decision commits
**Then** `payment_approved` (plan, expiry date) or `payment_rejected` (reason, how to resubmit) is sent after commit; a send failure is logged, shown to the Admin, and does not roll back (FR13)
**And** `GET` lists pending oldest-first with user email, plan, USD amount, transaction ID, submitted time, duplicate flag and history.

**Given** `cases.json`
**When** run on both the TS reader and the SQL writer
**Then** renewal, upgrade-with-queue, queued downgrade, after-expiry and admin-override scenarios all agree.

### Story 4.6: Admin queue, viewer, decisions and history

As the founder,
I want a mobile-friendly queue where I inspect receipts and approve or reject,
So that I can clear payments in under thirty seconds from my phone.

**Acceptance Criteria:**

**Given** the Admin Queue
**When** requests are pending
**Then** cards show oldest-first user email, plan, **expected USD amount**, transaction ID, submitted time, a duplicate warning alert ("This transaction ID was used in another request ({link})") when applicable, and a screenshot thumbnail (UX-DR10)
**And** at `lg` it is a two-pane layout (list left, selected request right), below `md` a single column ordered facts → screenshot → actions.

**Given** the thumbnail is tapped
**When** the viewer opens
**Then** the image shows full-screen with pinch/zoom, alt "Payment receipt submitted by {user}", closable by keyboard/`Esc`, with an "Open in new tab" fallback for PDFs.

**Given** Approve (primary) and Reject (outline, danger text) of equal size and ≥44px
**When** Approve is pressed
**Then** a Dialog (`md+`) or bottom sheet (`<md`, `rounded-t-2xl`, safe-area padding) restates user, plan, amount and the resulting expiry ("active from today until {date}"), focus lands on the title, and one "Approve" button confirms (UX-DR11).

**Given** Reject
**When** the sheet opens
**Then** a required reason textarea with the hint "This text is emailed to the user" is shown and "Reject" stays disabled until non-empty.

**Given** another session decided the request
**When** the card is acted on
**Then** actions disappear, the card shows the decision and who/when, and a stale action shows "This request was already decided."

**Given** an empty queue
**When** rendered
**Then** it reads "No payments waiting." and nothing else.

**Given** the Admin History tab
**When** a decided request's email failed
**Then** a warning badge "Email not sent" is shown while the decision still shows as made (FR13)
**And** decided requests show who/when and remain listed, paginated.

**Given** keyboard use
**When** in the queue
**Then** `Enter` opens a card and `Esc` closes the viewer or confirmation, and status changes announce via `aria-live="polite"` (UX-DR16).

## Epic 5: Turnstile Bot Protection

Signup, login, password reset and the payment form reject bots and fail closed if verification is unavailable.

### Story 5.1: Turnstile widget and payment-form verification

As the founder,
I want the payment form protected by server-verified Turnstile that fails closed,
So that bots cannot flood my review queue.

**Acceptance Criteria:**

**Given** a shared Turnstile widget component using `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
**When** rendered in a form
**Then** it uses managed size under the last field and above submit with reserved height (no layout jump), is keyboard-reachable and never blocks focus order, and submit is disabled until a token exists (FR17, NFR6, UX-DR14).

**Given** `lib/server/turnstile.ts` — the only code that calls Cloudflare `siteverify`
**When** `POST /api/payments` runs after the guard and before validation
**Then** it posts secret and token (`remoteip` only when a trusted single client IP exists) with a 5-second timeout (FR17)
**And** `missing-input-response`, `invalid-input-response`, `timeout-or-duplicate` return 400 `CAPTCHA_FAILED`
**And** timeout, network error, missing/invalid secret or `internal-error` return 503 `CAPTCHA_UNAVAILABLE`, never fail open (FR18)
**And** a mocked-fetch test covers every branch including timeout.

**Given** a rejected submission
**When** the form shows "Verification failed. Please try again." or "Verification is unavailable right now. Please try again in a moment."
**Then** the widget resets, typed values and chosen file are kept, focus returns to the widget with the message announced.

**Given** logs
**When** a failure is recorded
**Then** it contains error codes only, never the token or secret, and the secret is never sent to the client (NFR5).

### Story 5.2: Turnstile on signup, login and password reset

As the founder,
I want bots kept out of signup, login and password reset,
So that quotas and my review queue mean something.

**Acceptance Criteria:**

**Given** the existing signup, login and forgot-password pages
**When** rendered
**Then** each shows the Turnstile widget and passes its token as `options.captchaToken` to the Supabase call (FR17)
**And** no custom verifier is added for these three flows (AD-9).

**Given** a missing or invalid token
**When** the form is submitted
**Then** no account is created or reset email sent, and the user sees the retryable message with the widget reset and the email field preserved.

**Given** rollout step 6
**When** the founder deploys this code
**Then** Supabase CAPTCHA (Turnstile) is enabled in the dashboard only after the widget code is live
**And** a smoke test confirms signup, login and reset succeed with a token and one attempt with Cloudflare unreachable fails with the unavailable message (FR18).

**Given** mobile browsers
**When** the forms are used on iOS Safari and Chrome
**Then** the widget loads and works (NFR6, UX-DR18).

## Epic 6: Expiry Reminders & Screenshot Retention

Paid users are emailed once before expiry, and payment screenshots are deleted after 12 months.

### Story 6.1: Daily job with expiry reminders

As a paying user,
I want one email 3 days before my plan expires,
So that I can renew without losing access.

**Acceptance Criteria:**

**Given** `GET /api/cron/daily` (guard: cron, `export const dynamic = 'force-dynamic'`)
**When** called without `Authorization: Bearer <CRON_SECRET>`
**Then** it returns 401 and does nothing.

**Given** a non-voided period with `now < ends_at <= now + 3 days` and no non-voided period starting at or after its `ends_at`
**When** the job runs
**Then** it claims it by inserting an `email_log` row unique on `(template, subject_id)` (subject = period id) and sends `expiry_reminder` to the user (FR14)
**And** a period already renewed beyond the window is skipped.

**Given** the job runs twice in a day or a day is skipped
**When** reminders are evaluated
**Then** at most one reminder is sent per period, a failed send is marked failed and retried by a later run while the period still qualifies, and nothing depends on an exact time of day.

**Given** the job
**When** it runs
**Then** it never modifies `plan_periods` and logs only non-sensitive data.

### Story 6.2: Screenshot retention and cron schedule

As the founder,
I want old payment screenshots deleted automatically,
So that sensitive financial images aren't kept beyond 12 months.

**Acceptance Criteria:**

**Given** payment requests with a screenshot older than 12 months
**When** the daily job runs
**Then** the storage object is deleted and `screenshot_path` is set to null while the request row (plan, transaction ID, decision, timestamps) remains (NFR3)
**And** running it again is a no-op.

**Given** `apps/web/vercel.json`
**When** reviewed
**Then** it has a `crons` entry for `/api/cron/daily` once a day (rollout step 7) and `CRON_SECRET` is documented in `.env.example`
**And** the runbook notes crons run on production only and previews/local call the route manually with the secret.

**Given** the Admin screenshot link for a request whose object was deleted
**When** opened
**Then** it shows "Screenshot removed after 12 months" instead of an error.
