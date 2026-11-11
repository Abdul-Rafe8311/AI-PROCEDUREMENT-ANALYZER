# Adversarial Review: ARCHITECTURE-SPINE.md (Subscriptions, Manual Payment & Turnstile)

Reviewer stance: each finding is a pair (or set) of independently built units that each obey every AD literally and still break an invariant or build incompatibly. Each ends with the AD to add or tighten. Severity: Critical / High / Medium / Low.

Verdict: NOT READY to build from. The ledger idea is sound, but the spine leaves the period-chaining rules, the concurrency boundary of the two plan-writing RPCs, and the SQL-versus-TS duplication of "current plan" under-specified. Eleven holes need AD changes before epics; the top five below would cause money loss or quota/plan corruption in production.

---

## H1 (Critical). Queued periods collide: "starts at current ends_at" produces overlaps and ties

Units: RPC `decide_payment_request` (renewal / lower-plan branches) vs `effectivePlan` and the "queued plan" display in `/api/me/entitlements`.

AD-3 says same-plan renewal and lower-plan purchase start at "the latest current `ends_at`" / "the current period's `ends_at`". "Current" is the one period covering `now`. Scenarios, each compliant:

- Max [0,30], Pro queued [30,60]. User pays Max again: renewal starts at 30 (the current period's end). Now Max and Pro both start at 30. `effectivePlan` takes "latest `starts_at`", and the tie is undefined. Whichever the DB returns first wins. The user may get Pro after paying for Max, or the reverse.
- Pro current, Plus queued [30,60]. User buys Plus again: "lower plan" starts at the current period's end = 30. Two Plus periods overlap on [30,60]. The user paid twice and receives 30 days. Nothing detects it.
- Day 10, Max current, Pro queued. User buys Pro: lower than current, so it queues at 30, and the Pro periods overlap.

Fix (new AD-3a): define `chainEnd(user) = max(ends_at)` over non-voided periods with `ends_at > now`, or `now` if none. Same-plan renewal and every lower-plan purchase start at `chainEnd` (renewal of the current plan while a queue exists lands after the queue). Add a total order for `effectivePlan` ties (`starts_at desc, created_at desc, id desc`) and a DB exclusion constraint forbidding overlap between non-voided periods of one user (`tstzrange(starts_at, ends_at)` with `&&`, `WHERE voided_at IS NULL`). The entitlements API must return an ordered `queued` array, not "a queued plan".

## H2 (Critical). Two plan writers with no shared lock: approval vs admin override vs concurrent approvals

Units: `decide_payment_request` (locks the request row) and `admin_set_plan` (locks nothing named).

AD-6 gives each RPC its own transaction. The only lock is on the payment request row. Under READ COMMITTED:

- Admin approves a Pro upgrade while a second tab applies an override. Each snapshot sees the old periods. Each inserts "starts now" and voids only the old rows it saw. Both new periods survive, both start at (near) the same `now`. The plan shown depends on microsecond ordering; the "latest `starts_at`" can be the lower plan. The audit log shows two clean decisions.
- Same defect between either RPC and an in-flight `reserve_pdf_quota`: the route computed `window_start` and `quota` from periods loaded before the RPC (AD-5 passes them in as parameters), so an upgrade or a void landing in between is billed against the old plan.

Fix (new AD-6a): every function that writes or voids `plan_periods` takes `pg_advisory_xact_lock(hashtext('plan:'||user_id))` first and re-reads the periods inside the lock. Compute `window_start`, `quota` and the plan check inside `reserve_pdf_quota` under the same lock, not from route parameters; the TS functions are then used only for display and for property tests of parity (see H3).

## H3 (High). "effectivePlan is the only definition" is impossible: the RPCs must re-implement it in SQL

Units: `lib/entitlements/effective-plan.ts` (pure TS) vs the plpgsql bodies in `0005_subscriptions.sql`.

AD-6 forces `decide_payment_request` to decide renewal/queue/upgrade and void rows. That requires "what is the current period and plan at now" inside Postgres. AD-3 forbids a second definition, AD-6 requires one. The implementer of the migration writes one anyway, using DB `now()` while the TS uses an injected app clock. Tests are `tsx --test` only, so there is no SQL test and no parity check. The two definitions drift on ties (H1), on voided rows and on the boundary `ends_at = now`.

Fix: choose one authority. Recommended: the SQL function `effective_period(user, at)` is the single definition, the TS `effectivePlan` is a documented mirror, and a parity test feeds identical fixtures to both (run against a local Postgres or pg-mem-free SQL fixtures). Boundary rule written down: half-open `[starts_at, ends_at)`.

## H4 (High). Renewal / purchase when no current period exists (expired, or Free)

Units: RPC branch logic vs FR-9 and the user email.

AD-3 defines renewal as `starts_at = latest current ends_at`. If the plan already expired when the admin approves (the normal case: user pays late, admin reviews 24h later), there is no current period. An implementation that takes "latest ends_at" among all periods backdates the new period to the old expiry, so the user pays 30 days and gets partial or zero days. FR-9 says "starts from approval time". The rule for "no current period" and for "same plan as an expired one" is simply absent. Also unspecified: classification is made at decision time, not submission time. A request submitted as "renewal" at day 28 and approved at day 31 must be reclassified; the request row must not carry an intent.

Fix (AD-3b): all classification happens inside the locked RPC at decision `now`: no chain => start `now`; chain => `chainEnd` for same/lower; higher than current => start now and void. Return `{starts_at, ends_at, kind: 'activated'|'queued'|'extended'|'upgraded'}` from the RPC so the email (below) can say the right thing.

## H5 (High). Upgrade and override silently void queued periods the user already paid for

Units: AD-3 void clause vs FR-10 and `payment_requests`.

The clause "void every other non-voided period whose `ends_at > now`" includes future queued periods. Max [0,30], Pro queued [30,60] (paid). User upgrades to a higher plan, or the admin sets an override: the queued Pro, which belongs to an approved paid request, is voided. The money is gone with no notice and no audit detail; FR-10 forfeits only "the remaining days of the previous Plan". The same applies to an admin override applied to correct a mistake, for example a short `ends_at`: after the override ends the user drops to Free although a paid queue was voided (see H6).

Fix (AD-3c): an upgrade voids only the period covering `now`; queued paid periods are retained and re-chained after the new period (their `starts_at` shift is itself an append: void and re-insert with new dates, keeping `payment_request_id`). Admin override must state in its UI/RPC whether it voids or preserves payment-sourced future periods (default: preserve); `audit_log.detail` lists every voided period id.

## H6 (High). Admin override with a short `ends_at` and the Free-window after it

Units: `admin_set_plan`, `quotaWindow` Free branch, `/api/me/entitlements.resetAt`.

- Override Pro, `ends_at = now + 5 days`. AD-5 says the paid window is "the 30-day cycle containing now", so `resetAt` shows `now+30d`, beyond the plan's end. The window should be `min(cycleEnd, ends_at)`.
- Free branch: "end of the most recent paid period that ended in this month". Is a voided period counted? A Pro period voided by an override at day 10 has an original `ends_at` of day 30. If the implementation of `quotaWindow` includes voided periods, after the override expires on day 20 the Free window starts at day 30, discarding ten days of real usage (quota bypass). If it excludes voided, fine. The spine says "paid period", not "non-voided", and `effectivePlan` and `quotaWindow` take the same `periods` argument.
- No CHECK that `ends_at > starts_at` or that `plan <> 'free'`. `admin_set_plan(plan='free')` or a past `ends_at` inserts a zero-length or Free period that, depending on loader, shadows or voids paid periods ("revoke" semantics undefined). A Free row would also win "latest starts_at" and mask real paid periods.

Fix (AD-5a): `quotaWindow` uses non-voided periods only and clamps `resetAt` to the period end; Free window start = max(month start, `max(ends_at)` over non-voided paid periods with `ends_at <= now`). Add CHECK constraints: `ends_at > starts_at`, `plan in ('plus','pro','max')`, override `ends_at > now`. Revoke is a separate explicit RPC that voids.

## H7 (High). RPCs are callable by browsers unless EXECUTE is revoked; RLS does not protect a SECURITY DEFINER function

Units: migration author vs AD-12.

AD-12 secures tables through RLS (no write policies). It says nothing about function privileges. Supabase exposes `public` functions at `/rest/v1/rpc/*` to `anon` and `authenticated` by default. `decide_payment_request`, `admin_set_plan`, `reserve_pdf_quota`, `confirm/release_pdf_usage` take `admin_email` / `user` as plain parameters. If any is `SECURITY DEFINER` (it will be the moment someone needs to write `audit_log`, which has no user policy, or to take the advisory lock under a restricted role), any logged-in user can call it with the anon key and approve their own request as "admin@...". Even as INVOKER, `reserve_pdf_quota(other_user, ...)` is harmless only by accident.

Fix (AD-12a): every RPC created in a `private` schema or with `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`, `SECURITY DEFINER` only with `SET search_path = ''`. Add a migration test that lists functions with execute granted to `authenticated`.

## H8 (High). Admin gate relies on "confirmed email" while the project plans email-confirmation off

Units: `requireAdmin` (AD-7) vs the auth configuration noted in project memory ("email-confirm-off still need running in Supabase dashboard").

With Supabase confirmation disabled, `email_confirmed_at` is set at signup with no proof of mailbox ownership. Anyone who signs up with an address in `ADMIN_EMAILS` before the founder does (or on an alias the founder has not registered) satisfies "confirmed email" and gets full admin: approve payments, grant Max, view screenshots. The same unverified email also becomes the target of approval/reminder emails.

Fix (AD-7a): prerequisite recorded as an invariant: Supabase "Confirm email" must be ON in production, checked at deploy; or the admin allowlist must key on `user_id` (uuid) in addition to email; reject admin if the account `created_at` is after the first admin login record. At minimum, add a launch checklist item and a startup self-check.

## H9 (High). Quota reserve: window/TTL/dedupe semantics leave double-spend and double-charge paths

Units: `/api/extract` route vs `reserve_pdf_quota` vs `confirm_pdf_usage`.

- TTL 10 minutes. Extraction of a large batch can exceed it. A concurrent request then no longer sees the reservation and also reserves; both confirm and the user ends over quota. A `confirm` of an already expired `reserved` row is unspecified (update-if-exists? insert?). There is also no cleanup of stale rows.
- Same hash twice: (a) within one batch, (b) in two concurrent requests. "Already confirmed" dedupe ignores `reserved`. The two requests each reserve, each confirm, and two `confirmed` rows exist for one hash, counted twice later (or counted once now, twice in the display). No unique constraint `(user_id, file_sha256, window)`. Confirm must be idempotent.
- Hash dedupe is "in the current window". After a paid-to-Free fallback (FR-16) the window restarts, so re-analysing an RFQ whose PDFs were uploaded on the paid plan counts again against Free, contradicting UJ-1/FR-2 "re-analysis does not consume quota". Dedupe scope should be per user, lifetime, not per window, or the PRD must be changed explicitly.
- The route must know which upload is the purchase-requisition ("never counted") before reserving, but classification happens inside extraction. The request contract (field names for PR vs quotations, base64 JSON from Fastn vs multipart) is unspecified.
- `used` shown by `/api/me/entitlements`: does it count live reserved rows as the gate does, or only confirmed? Not stated; FR-6 requires equality. No shared SQL function `count_pdf_usage(user, window_start)` is named.

Fix (AD-5b): reservation id returned by the RPC and passed to confirm/release; confirm/release are idempotent and keyed by id; reservation TTL longer than the route's max duration, with a reaper in the daily job; unique partial index on confirmed hashes; a single `pdf_usage_count` function used by gate and display; fixed request contract for PR versus quotations.

## H10 (Medium-High). Reminder job: no lower bound, dedupe races, failed attempts count as sent

Units: `/api/cron/daily` reminder task vs `email.ts` logging.

- Query "ends_at within 3 days" has no stated lower bound. If read as `ends_at < now + 3d`, the first run emails every already-expired period in history (mass blast to old customers and pilot users).
- Dedupe by `email_log` rows keyed `(template, subject_id)`. AD-10 says every attempt writes a row, including failures. Either failures dedupe (a failed reminder is never retried) or only successes dedupe (two overlapping job runs, or a scheduler retry, both pass the check-then-send and double-send). No unique constraint and no claim-before-send.
- A queued lower plan counts as "renewed beyond the window" because it is a non-voided period starting at `ends_at`. A Max user with a queued Pro gets no reminder that Max is ending. Product decision hidden inside a query.
- Override/admin-source periods and a period later voided between reminder and expiry are not addressed.

Fix (AD-11a): `ends_at between now and now + 3d`, `source` in both, unique index `(template, subject_id)` on a claim row inserted before sending with statuses `claimed|sent|failed`; failed rows retried at most N times; queued-lower counts as a renewal only if same or higher plan (or state the choice). Pure SQL claim returns the rows, so a double run cannot double-send.

## H11 (Medium). AD-8 and AD-10 contradict each other on rollback after upload

Units: `POST /api/payments` (AD-8 ordered steps) vs `email.ts` (AD-10).

AD-8 lists "send the admin email" as the last step and says "a failure after upload removes the object". AD-10 says email failure never fails the request and never rolls back. An implementer following AD-8 literally deletes the screenshot of a committed Pending request when Resend errors. Another implementing AD-10 literally leaves the order ambiguous. Also AD-8 uploads before the insert; the "one pending per user" partial unique index fails at insert, after a 5 MB upload and after the Turnstile token was consumed, which is only cleaned up on the error path (a crash leaves an orphan; the retention job only sweeps by `payment_requests` rows, so orphans are never deleted).

Fix (AD-8a): the email step is explicitly outside the removal scope; insert the row first with `screenshot_path` reserved (pre-generated `request_id`) or check the pending-request condition before upload; orphan sweeper for the bucket in the daily job.

## H12 (Medium). Single-point writer promises that are false in the spine

- `payment_requests`: AD-6 says the RPC is the only writer of `status`, but the retention job nulls `screenshot_path` and `POST /api/payments` inserts. Fine, but then the "only writer" claim must be per-column; today two modules legitimately own different columns of one entity without a stated boundary. Add a column ownership table.
- Post-commit email is not durable: after `decide_payment_request` commits, a crash before `sendEmail` loses the approval email with no `email_log` row, so the Admin Page "failure visible" promise cannot be met (FR-13). Fix: RPC inserts an `email_log` row with `status='queued'` in the same transaction (transactional outbox); the sender drains it; the daily job retries.
- `sendEmail(template, to, data)` shapes are not defined: `payment_approved` needs plan, `starts_at` and `ends_at` and whether it is queued (H4 return contract). Without a typed data schema per template the RPC author and the email author disagree on the date.

## H13 (Medium). Period loader contract: guard query shape starves `quotaWindow`

Units: `guard.ts` / `requireFeature` (AD-4: "one indexed query on `user_id, ends_at`") vs `quotaWindow`, `/api/me/entitlements`.

An implementer of the guard filters `ends_at > now` to stay within 100 ms. `quotaWindow`'s Free branch needs periods that already ended this month. If `/api/extract` reuses the guard's list, Free users get the wrong window start (a Free user right after expiry gets the whole month back: quota bypass). If `/api/me/entitlements` loads all periods, the display and gate disagree (FR-6). Both comply.

Fix (AD-4a): one `loadPeriods(userId, now)` in `lib/server/domain` that returns non-voided periods with `ends_at > monthStart(now) - 1 day` (covering everything `effectivePlan` and `quotaWindow` need), used by every consumer. Document the index as `(user_id, ends_at)` where `voided_at is null`.

## H14 (Medium). API-key principal: precedence, attribution, and no RLS backstop

Units: `requirePrincipal(allowApiKey)` vs everything else using the service-role client.

- Both `Authorization: Bearer` and `X-Api-Key` present with different users: precedence undefined. One unit takes the JWT, another the key; the quota is spent against the wrong user.
- `pdf_usage` has no `api_key_id` or `via`: AD-2 claims quota attribution, but a key-driven batch is indistinguishable from the user's own, and revocation cannot be reasoned about after the fact.
- All server reads and writes use the service role (AD-7, AD-12). RLS is a backstop only for the browser. A single missing `.eq('user_id', principal.userId)` in any domain module is a cross-tenant leak with no second defence, and API-key requests have no JWT so a user-scoped client was never an option. Add `forUser(principal)` repository helpers that cannot be called without a user id, and a lint/test banning raw `.from('plan_periods'|'payment_requests'|'pdf_usage')` outside `domain/`.
- Results of key-driven extraction go to Fastn only; the user is charged quota for analyses they cannot see in the app. State this or return an id the user can open.
- Revoked key / deleted or unconfirmed user: the check order (key lookup, then user state) is not given.

Fix (AD-2a): JWT wins if valid; if both are present and resolve to different users, 400. `pdf_usage.api_key_id`. Repository boundary rule above.

## H15 (Medium). Guard enforcement test is too weak and the gated-route list is incomplete

- The test checks "a route file calls one of requirePrincipal, requireFeature, requireAdmin or carries the marker". A file with `GET` guarded and `POST` unguarded passes; a file that calls `requirePrincipal` but ignores the result or calls it after reading the body passes. Check per exported HTTP method.
- Public wildcard `/api/cron/*`: any later cron route is exempt from review. Restrict to `/api/cron/daily`.
- Existing LLM routes not classified: `doc-answer` (calls Anthropic, RAG chat-like) is neither quota nor feature gated, so Free users get chat-class capability through it; `approve`, `dashboard`, `ta-form/export-excel` are unclassified. The spine gates only `chat` and `tender-sheet`. Add a route-to-gate table (one row per existing route) as an AD, otherwise FR-4/FR-5 are bypassable through `doc-answer`.
- `/api/intake` proxy is public and burns the mapped user's quota (deferred, but it makes "quota means something" false); at minimum cap per-IP.

## H16 (Medium). Entitlements API shape and duplicate read paths

Units: `/api/me/entitlements` vs plans/account pages vs RLS selects.

- Response fields are named only in prose ("plan, expiry, queued plan, used, quota, reset date"). Plan identifiers' casing, `null` for Free expiry, ISO format, and queued as single vs array (H1) are unspecified; the page and the route are built independently and will mismatch.
- AD-12 grants RLS `select` on `plan_periods`, `payment_requests`, `pdf_usage`. If the account page reads payment history (FR-8) directly with the browser client, there are two read paths. A browser reading `pdf_usage` shows `reserved` rows and stale counts, bypassing AD-4's "only the API". RLS select also exposes `plan_periods.created_by` (admin email) and `voided_at` history to users. Either drop the select policies and serve history through an API route, or narrow with views.
- "Plans page reading config via an API" (bank details, prices) names no route; if unguarded, bank details are public.

Fix (AD-4b): publish the `Entitlements` and `PaymentSummary` TypeScript types in `lib/entitlements/types.ts` as the contract; remove user select policies except through those views.

## H17 (Low-Medium). Smaller items

- Demo-mode synthetic Max principal: AD-1 defines the principal only; the reserve RPC, payments and cron have no demo branch, so demo mode crashes at `/api/extract` or silently writes to a null DB. Specify where the bypass lives (a `demoEntitlement` in guard and a no-op quota adapter).
- Duplicate transaction-id flag: normalisation (case, whitespace) is not specified, and a user's own earlier rejected request flags their resubmission as a duplicate. Exclude same-user rejected rows; normalise at insert.
- `getUser(token)` is a network call to Supabase Auth on every request; the 100 ms p95 NFR from Saudi/Render to hosted Supabase is likely unmet. Add a decision (local JWT verification with the JWT secret, with revocation caveat) or relax the NFR. Stale access token handling in `apiFetch` (refresh before call, single retry on 401) is unspecified.
- Retention job: deletes objects by `created_at`, including those of Pending requests older than 12 months; cron time zone and storage-delete-then-null crash window leave dangling paths (idempotent retry fixes it, but state it).
- Time source: reserve RPC uses DB `now()` for the 10-minute TTL, TS uses injected app clock for windows (skew of seconds around month boundary and expiry). Pass one `now` or use the DB clock for both.
- Month boundary: a reservation made at 23:59:50 Riyadh and confirmed after midnight lands in the old window (created_at). Acceptable, but should be stated to avoid a test disagreement.

---

## Summary of new/tightened ADs required

1. AD-3a/3b/3c: chainEnd, tie-break, no-overlap exclusion constraint, no-current-period rule, void scope.
2. AD-6a: per-user advisory lock for all plan writers and the quota reservation; RPC returns a typed result.
3. AD-3d: single authority for "current period" (SQL) with TS parity test.
4. AD-5a/5b: window clamp, voided periods excluded, CHECK constraints, idempotent reservation ids, shared count function, dedupe scope, request contract.
5. AD-12a: revoke EXECUTE on RPCs from public roles; schema/search_path rules; RLS select narrowing.
6. AD-7a: confirmed-email prerequisite or uuid-pinned admin.
7. AD-11a / AD-10a: reminder window bounds, claim-before-send, outbox row in the decision transaction.
8. AD-8a: reconcile with AD-10; orphan sweeper.
9. AD-4a/4b: single `loadPeriods`, typed `Entitlements` contract.
10. AD-1a / AD-2a: per-method guard test, route-to-gate table including `doc-answer`, JWT-over-key precedence, `api_key_id` on usage, repository boundary.
