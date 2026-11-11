---
title: 'Story 2.4: Usage figures and header usage meter'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

`GET /api/me/entitlements` returns `used`, `quota`, `resetAt` from `quotaWindow` and `countUsed` (same window and count rule as the gate), 503 on count failure (never a fake 0), `Server-Timing` header and a warning log when the check exceeds 100 ms. `use-entitlements.ts` becomes a shared per-user cache with `refreshEntitlements()` (called after every `/api/extract` response). `UsageMeter` (md+, between Admin link and user menu) and `UsageMeterStrip` (below md, full width under the header row, not in any menu) render "{used} / {quota} PDFs used this month|period" with `role="progressbar"`, aria-valuemin/max/now and the visible text as its accessible name, links to `/plans`, skeleton while loading, nothing on error (never "0 / 0"), fill tint warning at 80% and danger at 100%, no animation beyond the skeleton. View-model `meterModel` is pure and tested.

## Decisions

- The meter is wired into the workspace header, the only signed-in page with a header today; the Plans page (2.6) gets it too.
- The 100 ms NFR is covered by a fast-deps test plus the Server-Timing header and slow-call log, not a real-DB benchmark.

## Verification

New `me-entitlements.test.ts`, `usage-meter.test.ts`, updated route test. `npm test` 394 pass, `tsc` clean. Component rendering is not tested (runner covers `.ts` only) and not viewed in a browser (Node 25 / no Supabase key locally).
