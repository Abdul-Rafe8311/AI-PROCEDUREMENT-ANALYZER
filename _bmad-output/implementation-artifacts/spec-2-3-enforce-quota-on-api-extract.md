---
title: 'Story 2.3: Enforce quota on /api/extract'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

`/api/extract` reserves quota for the SHA-256 of every distinct quotation file (never the PR) via `lib/server/extract-quota.ts` before any extraction runs. Over quota: 429 `QUOTA_EXCEEDED` `{ plan, quota, remaining, resetAt }`, whole batch, nothing counted. After extraction each reserved hash is confirmed if its file yielded usable data, otherwise released (also on the 422 and 500 paths). Re-analysis of confirmed hashes is free (SQL). `STALE` recomputes the window once and retries; a second `STALE` or any DB error returns 503 (fail closed). Demo principal skips quota. `analysis-engine.ts` and `extraction-server.ts` are unmodified.

## Decisions

- "Success" = the file produced at least one quotation with a total or line items, the same test the route already uses to decide a file failed.
- Quota applies to api-key and JWT principals alike.

## Verification

`extract-quota.test.ts` covers Free with room, 429 body, paid period id and quota, STALE retry, STALE twice, DB failure, demo skip, settle confirm/release and never-throw. `npm test` 387 pass, `tsc` clean. Route wiring itself is not integration-tested (extraction needs the Anthropic key, which policy forbids using).
