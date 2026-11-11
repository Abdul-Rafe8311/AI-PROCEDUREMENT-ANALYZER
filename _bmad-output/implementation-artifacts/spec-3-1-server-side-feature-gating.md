---
title: 'Story 3.1: Server-side feature gating'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

`requireFeature(req, 'chat' | 'tender_sheet', deps?)` in `lib/server/guard.ts` runs `requirePrincipal`, loads non-voided periods (`loadPeriods`, `ends_at >= now - 62 days`, one query), computes `effectivePlan` and allows or denies from `plans.ts` (`hasChatAccess`, `hasTenderSheetAccess`). Denial: 403 `PLAN_REQUIRED` `{ error, code, feature, requiredPlan }` (`plus` for chat, `pro` for tender sheet). Demo principal (Max) passes without a DB read. A DB failure returns 503 `SERVICE_UNAVAILABLE` (fail closed). No caching. `chat` and `doc-answer` become `// guard: feature:chat`; `tender-sheet/fill` and `export` become `// guard: feature:tender_sheet`. `REQUIRED` map in the marker test updated.

## Decisions

- Required plan per feature lives in `plans.ts` (`featureRequiredPlan`, `canUseFeature`) so the UI (Story 3.2) shares it.
- `ta-form/export-excel` stays `public` (Fastn) per the spine.
- Clients already use `apiFetch`, so Bearer tokens flow without client changes.
- Chat has no message cap.

## Verification

Tests for `requireFeature` (free/plus/pro/max matrix, expired plan falls to free, queued period not yet active, 401, 503, demo) and updated marker test. `npm test`, `tsc` clean.
