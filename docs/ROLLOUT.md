# Subscriptions rollout runbook

Follow the steps in order; each must finish before the next, or live flows break
(spine, "Rollout order"). Tick items as you go. Stories that ship later steps are
noted so you can skip steps whose code is not built yet.

## Step 1: database (Supabase dashboard)

- [ ] In the SQL editor, run `apps/web/supabase/migrations/0005_subscriptions.sql` (idempotent; enables `btree_gist`).
- [ ] Run `0006_admin_set_plan.sql`.
- [ ] Storage: create a **private** bucket named `payment-proofs` (needed from Epic 4).
- [ ] Run `apps/web/supabase/runbook/cases.sql`. Expect `NOTICE: all 9 checks passed`. Any exception means stop and fix; it rolls back and touches only a temp table.
  Regenerate it after editing `cases.json`: `node scripts/gen-cases-sql.mjs` (in `apps/web`).

## Step 2: environment (Vercel project settings)

Set every variable listed in `apps/web/.env.example` (never edit `.env*` files in git).

- [ ] `ADMIN_EMAILS` and `ADMIN_USER_IDS`: an admin needs both.
- [ ] `SUPPORT_EMAIL`, `BANK_DETAILS` (JSON), `PLAN_PRICES_USD` (JSON), `CRON_SECRET`.
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`; `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (when Epics 4-5 ship).
- [ ] `ALLOW_DEMO` must be unset in production.
- [ ] **Pre-launch gate, Resend:** sending-domain verification status: `not verified / verified on ____`. Real payments are not accepted until this reads verified.

## Step 3: Fastn (after Epic 2, story 2.1)

- [ ] Mint an API key for the pilot account and make the intake workflow send `X-Api-Key` on its `/api/extract` and `/api/ta-form/export-excel` calls. Change it in Fastn; do not edit `workflow.json` here.

## Step 4: deploy

- [ ] Deploy `apps/web`. Before step 3 is done, `/api/extract` rejects Fastn once 2.1 ships.
- [ ] Before pushing: `npm test` and `npx tsc --noEmit` in `apps/web`.

## Step 5: seed the pilot on Pro (before any quota is visible)

- [ ] Edit and run `apps/web/supabase/runbook/seed-pilot.sql` (or use the Admin Users tab). Each pilot user must show Pro with a future expiry.
- [ ] Use fake suppliers in every demo, screenshot and fixture; never Najran Cement's real data.

## Step 6: Turnstile (after Epic 5)

- [ ] Enable CAPTCHA in the Supabase dashboard only after the widget is deployed; smoke-test signup, login, reset, and one with Cloudflare unreachable (expect failure).

## Step 7: cron (after Epic 6)

- [ ] Add the `crons` entry for `/api/cron/daily` to `apps/web/vercel.json` (daily) and set `CRON_SECRET`.
