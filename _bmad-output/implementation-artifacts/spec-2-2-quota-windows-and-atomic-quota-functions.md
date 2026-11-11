---
title: 'Story 2.2: Quota windows and atomic quota functions'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

`quotaWindow(periods, now)` in `lib/entitlements/quota-window.ts` (AD-5; Riyadh math only there; 10 cases in `quota-window-cases.json`: Free, Paid cycle 1 and 2, period ending inside a cycle, Free after a paid plan ended mid-month / last month, voided, queued, Riyadh month boundaries). `PlanPeriod` gains optional `id`, `loadPeriods` selects it. `lib/server/usage.ts` wraps migration 0008 (`reservePdfQuota`, `confirmPdfUsage`, `releasePdfUsage`, `countUsed` with the same count rule as SQL, `sha256Hex`). Migration 0008 itself was committed earlier and applied by the founder.

## Decisions

- Window cases live in a separate `quota-window-cases.json`: the SQL side of `cases.json` covers effective plan only, and no window logic exists in SQL.

## Verification

`npm test` and `tsc` clean. The SQL functions are not exercised by tests (no Postgres here); the founder applied 0008 but has not run behavior checks on it.
