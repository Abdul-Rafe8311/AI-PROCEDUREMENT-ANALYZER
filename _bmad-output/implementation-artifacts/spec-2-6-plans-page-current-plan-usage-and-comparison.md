---
title: 'Story 2.6: Plans page, current plan, usage and comparison'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

`/plans` (RequireAuth) shows plan name, "Active until {date}" (paid only), "X of Y PDFs used", reset date; four plan cards (1/2/4 columns) with USD price "/ month", quota and Check/Lock rows for Chatbox and Tender sheet, current plan with a 2px primary border and "Current plan" badge, none promoted, no action buttons (Epic 4 adds them). Comparison table at md+ and a "Compare plans" toggle revealing stacked cards below md; rows PDFs per month, Chatbox, Tender sheet, Priority Support (Max 12h, others 48h), Price. `GET /api/billing/config` (jwt) serves prices (`PLAN_PRICES_USD`, wrong shape becomes null and renders a dash) and the support address; never `NEXT_PUBLIC_*`. Inline notices: paid plan with <=3 days left, and a one-time "plan ended" note driven by a new `lastExpired` field on `/api/me/entitlements` and remembered per viewer in localStorage. Plans link added to the user menu; header meter present on the page. Data and copy live in pure, tested modules (`plan-matrix.ts`, `plan-notice.ts`).

## Decisions

- Prices are display-only from config; if `PLAN_PRICES_USD` is unset the cards show "—" instead of invented prices.
- "Priority Support" cell text is "12h reply (priority)" / "48h reply".
- Only existing CSS tokens used (success, muted, primary, border); dark mode comes from them.

## Verification

New tests for plan-matrix, plan-notice, billing-config, entitlements `lastExpired`. `npm test` 409 pass, `tsc` clean, `next build` succeeds with `/plans`. Not viewed in a browser (no Supabase key locally).
