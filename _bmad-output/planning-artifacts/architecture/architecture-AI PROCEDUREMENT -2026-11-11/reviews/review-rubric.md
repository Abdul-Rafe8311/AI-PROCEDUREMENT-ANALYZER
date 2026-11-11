# Rubric review: ARCHITECTURE-SPINE.md vs PRD + addendum

Date: 2026-11-11. Read-only review; spine not edited. Brownfield spot-checks: `apps/web/src/app/api/*` (10 routes), `lib/auth-context.tsx`, `lib/supabase.ts`, `app/workspace/page.tsx`, `lib/rag-client.ts`, migrations 0001-0004, Dockerfile, `.env.example`.

## Verdict

**Conditional pass: revise before epics.** Structure is strong (ledger, single RPCs, guard-then-handle). One High finding contradicts the live code and would break the Fastn pilot on deploy. Several Medium gaps are quiet PRD requirements or unenforced rules.

## Severity-ranked findings

### H1. AD-1 "everything else guarded" contradicts brownfield; breaks live Fastn flows
Routes that exist today: chat, fx, intake, dashboard, approve, doc-answer, extract, ta-form/export-excel, tender-sheet/fill, tender-sheet/export. The spine's public set is only `/api/fx`, `/api/intake`, `/api/cron/*`.
- `/api/dashboard`: POST is called by the Fastn workflow (no user, no key); GET is an emailed token link opened by a buyer with no session (route comment says so).
- `/api/approve`: GET `?token=` link from the email, plus a server-side POST. Same pattern.
- `/api/doc-answer`, `/api/ta-form/export-excel`: guarded under AD-1 but the spine never says how (principal only? feature?).
Result: the AD-1 enumerating test either fails day one or someone adds `guard: public` markers ad hoc, which is the exact divergence AD-1 prevents. Spine ratifies only `/api/extract` and `/api/intake` as Fastn touchpoints.
Fix: enumerate every existing route with its guard class (principal / feature / api-key / token-link / public). Decide dashboard/approve auth explicitly (token is the capability, or extend API-key).

### M1. FR-7 / FR-19 have no named delivery route
FR-7 map row says "plans page reading config via an API". No route is named in the Structural Seed (`me/entitlements, payments, admin/*, cron/daily`). Bank details, USD prices, `SUPPORT_EMAIL`, response targets must reach the browser without `NEXT_PUBLIC_`. Two units could add two endpoints or leak `BANK_DETAILS` via a public env. Also FR-8 "request appears in their payment history": no `GET /api/payments` or history source named (RLS allows own select but UI "never touches" DB). Fix: name `GET /api/plans/config` (guarded) and `GET /api/payments`.

### M2. Period-date logic lives in SQL with no test strategy; ledger rules incomplete
- AD-3 insertion rules (renewal, queued downgrade, upgrade-with-void) execute inside plpgsql `decide_payment_request`; tests are `tsx --test` on pure TS only. FR-9/FR-10/FR-12 date math (the money-critical part) has no enforceable test. There are two implementations (TS `effectivePlan`, SQL writers) and nothing ties them. Fix: put the "next period placement" function in `lib/entitlements/` and have SQL only persist its result, or add pgTAP/SQL tests in the suite.
- Gaps in the rules: "starts_at equal to the latest current ends_at" is undefined when a queued period already exists (second early renewal, or renewal plus queued lower plan => equal `starts_at` tie in `effectivePlan`); renewal after expiry (FR-9 bullet 2, "from approval time") is not stated; an upgrade silently voids a queued, already-paid lower-plan period (PRD forfeits only remaining days of the current plan; no refund/notice path).
- `decide_payment_request` locks the request row, not the user; a concurrent `admin_set_plan` can interleave. Add a per-user advisory lock to both RPCs (AD-5 already uses one).

### M3. AD-7 "confirmed email" conflicts with auth status in memory/code
Project memory records email-confirm-off still pending in the Supabase dashboard; `auth-context.tsx` handles both modes (`needsEmailConfirmation`). If confirmation stays off, `requireAdmin` may lock the founder out; if it is off and the founder's email is not yet registered, anyone can claim it. Spine states neither the required dashboard setting nor the bootstrap order. Add a launch precondition.

### M4. FR-18 fail-closed left open in Deferred
"Supabase-native CAPTCHA behavior when Cloudflare is unreachable" is Deferred, but FR-18 is a hard requirement and units for signup/login/reset can ship fail-open. Make the verification a gate on AD-9 (decision recorded, fallback server verifier named as the default if unconfirmed), not a deferral.

### M5. Other Deferred items that can make units diverge or violate PRD
- `/api/intake` abuse: public endpoint can drain the mapped user's quota (counter-metric SM-C3, pilot users). Also one API key = one user means all email intake bills one account; PRD silent on whose quota. Needs a decision, not "wait for evidence".
- Scheduler host: contract fixed (OK), but FR-14 reminders and 12-month retention do not run until chosen; no launch gate listed.
- Rollout ordering absent: guarding `/api/extract` immediately breaks the live Fastn workflow until an API key is minted and `workflow.json` (edit-denied in repo) sends `X-Api-Key`. Cutover sequence missing.

### M6. Several Rules are convention, not enforceable
AD-4 ("not cached"), AD-6 ("only writer"; service-role client can write anywhere), AD-9 ("only code that calls siteverify"), AD-10 ("Resend called only here"), AD-3 ("only code that answers what plan"): no test/grep/lint named. Only AD-1 (route enumeration) and AD-12 (import boundary) have tests. Cheap fix: add grep-based tests (`siteverify`, `api.resend.com`, `plan_periods` inserts only in migrations/RPCs).

### L-items
- **Re-analysis (FR-2):** covered via SHA dedupe, but dedupe is window-scoped ("confirmed in the current window"). Brownfield re-analysis re-POSTs files to `/api/extract` (workspace/page.tsx:441); a re-analysis after the window rolls over consumes quota again. PRD says re-analysis of already-uploaded PDFs is never counted. Decide and state. Note also `persistUpload` runs before extract in the client.
- **FR-8 one pending:** index exists (AD-6) but no error code in the convention table (needs `PENDING_EXISTS` 409 or similar). Reject requires typed reason: RPC takes `reason` but no rule says non-empty is required for reject.
- **FR-13:** `payment_rejected` template exists, but nothing says it carries reason and resubmit instructions; approval email needs expiry date (and queued start date for downgrades). Only template names are specified.
- **FR-16 Free after expiry:** covered by `quotaWindow` max() rule. Ambiguity: "most recent paid period that ended in this month" with voided periods (upgrade voids earlier ones, a downgrade-to-Free admin override voids) and with a queued period starting at expiry. Add test cases to Tests row.
- **FR-19 / NFR 12-month retention / EMAIL_FROM:** covered (AD-7/map; AD-8/AD-11; AD-10/config). Resend verified-domain launch dependency (PRD §8) not carried into spine.
- **NFR plan check <=100 ms p95:** AD-1 `supabase.auth.getUser(token)` is a network call to Supabase Auth on every request, in addition to the DB query. Budget not reconciled; consider local JWT verification or define the NFR as excluding auth.
- **Config contradiction:** Config row says `config.ts` is sole reader "for new features"; AD-12 says "every secret". Existing code reads `ANTHROPIC_API_KEY` etc. elsewhere. Clarify scope.
- **Client call sites:** AD-1 mandates `apiFetch` but does not list the ones to convert (workspace/page.tsx extract+chat, tender-sheet-panel, approval-form-download, tender-sheet/generate.ts, rag-client `/api/doc-answer`). `rag-client` also calls the legacy NestJS `API_BASE`; say it is out of scope.
- **Structural seed:** proposes `src/app/(app)/plans|account|admin`; actual layout is `app/workspace` and `app/(auth)`; no `(app)` group exists. Confirm placement relative to the existing auth/layout provider.
- **Traceability:** FR-3, FR-9, FR-10, FR-12 mapped; FR-1..FR-19 all appear in `binds` and map. No FR is wholly dropped.

## Check 1: FR coverage table
| FR | Covered | Note |
|---|---|---|
| 1, 16 | AD-3, AD-5 | FR-16 edge cases untested (see L) |
| 2 | AD-5, AD-2 | re-analysis window-scoped; failure/release, batch reject, server-side OK |
| 3 | AD-3, AD-5 | OK |
| 4, 5 | AD-4 | OK |
| 6 | AD-4, AD-5 | OK; shared `quotaWindow` good |
| 7 | map only | route unnamed (M1) |
| 8 | AD-6, AD-8, AD-9 | pending code missing; history source missing |
| 9, 10, 12 | AD-3, AD-6 | gaps in M2 |
| 11 | AD-7, AD-6 | OK |
| 13, 14 | AD-10, AD-11 | content of reject/approve email unspecified |
| 15 | AD-6, AD-7 | OK |
| 17, 18 | AD-9 | fail-closed of native flow deferred (M4) |
| 19 | AD-7 + map | OK |
| NFR retention, EMAIL_FROM, private bucket | AD-8, AD-11, AD-10 | OK |

## Check 2: AD rule enforceability
Enforced by test: AD-1 (route enumeration), AD-12 (import boundary), AD-3 (`effectivePlan` unit tests, implied). Convention only: AD-2 (Rule says key only on `/api/extract`; no test), AD-4, AD-6, AD-8 (bucket policy is SQL, untested), AD-9, AD-10, AD-11. See M6.

## Check 3: Deferred divergence risk
Risky: CAPTCHA native behavior (M4), intake abuse/quota owner (M5), scheduler host (M5). Safe: API-key UI, staging/CI, non-goals.

## Check 4: Brownfield ratification
Ratified correctly: localStorage session via `lib/supabase.ts`, `{error}` shape, `console.error('[api/...]')`, `0005+` numbering and idempotent style, Node 22 Dockerfile + `output: standalone`, `tsx --test`, existing extract JSON+base64 path, intake CORS proxy, no staging/CI. Contradicted or unaddressed: H1 (dashboard, approve, doc-answer, export-excel), client fetch sites, `(app)` route group, ANTHROPIC key reading vs "every secret". Migration 0001's storage hardening block is commented out; spine's bucket `payment-proofs` policy is new and fine.

## Check 5: Silent dimensions
Deployment is one paragraph; hosting provider is unknown and unnamed (also blocks scheduler). Missing: env-var-per-environment inventory (only `.env.example` list), migration apply order vs deploy, Supabase dashboard prerequisites (CAPTCHA provider, email confirmation, SMTP/Resend sender, bucket), rollback, backups, monitoring/alerting for email failures beyond the Admin Page, secrets rotation, Resend domain verification gate. Add a short "Launch preconditions and rollout order" section.
