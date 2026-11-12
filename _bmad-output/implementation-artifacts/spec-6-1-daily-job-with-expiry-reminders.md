---
title: 'Story 6.1: Daily job with expiry reminders'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

`GET /api/cron/daily` (marker `cron`, `force-dynamic`) is guarded by `requireCron`: `Authorization: Bearer <CRON_SECRET>`, compared in constant time; missing or wrong is 401 and nothing runs; an unset secret is 503 (never open). `runDailyJob` (`lib/server/daily-job.ts`, injected stores, no clock or network of its own) finds non-voided periods with `now < ends_at <= now + 3 days`, skips any whose user has a non-voided period starting at or after that `ends_at`, and sends `expiry_reminder` through `sendEmail` with `subjectId = period id`. The unique `email_log (template, subject_id)` claim makes it at-most-once per period; a `failed` claim is re-claimed atomically (`update ... where status='failed'`) so a later run retries while the period still qualifies. Nothing depends on time of day. It never writes `plan_periods`; the response and logs are counts only.

## Decisions

- No new migration: 0010 already has the unique reminder index. A row stuck in `pending` (crash mid-send) is not retried; that favours never double-sending.
- Reminder email address comes from `auth.admin.getUserById`; a user with no email is skipped.
- A task that throws makes the route 500 (visible in Vercel's cron log) but the other task still runs.

## Verification

`daily-job.test.ts` (window, one reminder per period with the period id, renewed skipped, earlier-starting period not a renewal, already-claimed skipped, failed counted and run continues, no email, double run), `cron-guard.test.ts` (valid, missing, wrong, malformed, prefix, unset secret 503), route-guards test extended for the `cron` class. `npm test` 574 pass, `tsc` clean, `next build` ok.
