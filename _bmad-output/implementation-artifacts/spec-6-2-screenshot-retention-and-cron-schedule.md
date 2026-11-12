---
title: 'Story 6.2: Screenshot retention and cron schedule'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

The daily job also deletes payment screenshots older than 12 months (`created_at < now - 12 months`, up to 200 per run, oldest first): the storage object is removed first, then `screenshot_path` is set to null, so a failed delete leaves the path and is retried the next day; the request row (plan, transaction id, decision, timestamps) stays; a rerun finds nothing. `apps/web/vercel.json` schedules `/api/cron/daily` daily at 06:00 UTC. `CRON_SECRET` was already in `.env.example`; `docs/ROLLOUT.md` step 7 now says crons run on Production only and previews/local call the route manually with the bearer secret. `GET /api/payments/[id]/screenshot` for a removed file is 404 `SCREENSHOT_REMOVED` with "Screenshot removed after 12 months."; the Admin panel shows that text instead of "No receipt stored." (every request is created with a screenshot, so a null path means removed).

## Verification

`daily-job.test.ts` retention cases (cutoff, delete-then-null order, failed delete keeps path and batch continues, failed clear, empty rerun), `payments.test.ts` updated for the removed message and code. `npm test`, `tsc`, `next build`.
