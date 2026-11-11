---
title: 'Story 2.5: Upgrade callout on blocked uploads'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

A 429 `QUOTA_EXCEEDED` from `/api/extract` shows an inline `role="alert"` callout under the upload zone (not a dialog, toast or banner): all used -> "You've used all {Y} PDFs on your {Plan} plan. Resets on {1 Dec 2026}. See plans."; batch over -> "You selected {n} PDFs but have {r} left. Remove {n-r} or see plans." Buttons "See plans" (links to `/plans`) and "Not now" are equal size (44px); "Not now" dismisses it until the next blocked attempt (each Analyze click clears it). Extraction failures (422/500/503) append "This didn't use any of your PDFs." to the existing error. Copy and parsing are pure (`lib/quota-callout.ts`, tested); dates via `formatQuotaDate` in `quota-window.ts` (Riyadh calendar date, the only place Riyadh math lives).

## Decisions

- `n` is the number of quotation files selected, not de-duplicated against free re-uploads, so the "remove n-r" figure is an upper bound.
- No upgrade prompt appears anywhere else (UX-DR15).

## Verification

`quota-callout.test.ts` (copy, date formatting incl. Riyadh midnight boundary, 429 parsing, failure note). `npm test` 399 pass, `tsc` clean. Not viewed in a browser.
