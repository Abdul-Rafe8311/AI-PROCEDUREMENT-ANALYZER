---
title: 'Story 2.1: API-key principal for the Fastn intake workflow'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

`requirePrincipal(req, { allowApiKey: true })` accepts `X-Api-Key` (SHA-256 lookup in `api_keys`, migration 0007) or a JWT and yields `{ userId, via: 'api_key' | 'jwt' }`. Unknown or revoked key: 401 `UNAUTHENTICATED`, never falling back to a JWT. On every other route the header is ignored. `POST/DELETE /api/admin/api-keys` (admin) create (raw key returned once, only hash stored, audit row holds key id only) and revoke. `/api/extract` becomes `apikey`.

## Decisions

- `/api/ta-form/export-excel` is deliberately left `public`. The epic says switch it only after the Fastn workflow sends `X-Api-Key` on that call, and I cannot confirm that. One-line change later: marker `apikey` + `requirePrincipal(req, { allowApiKey: true })` + `REQUIRED` entry. Logged in deferred-work.
- `/api/extract` now rejects unauthenticated callers (spine rollout step 3 before deploy).
- Api-key principals have `email: null` and no user-scoped client exists for them.

## Verification

Guard tests (valid key, revoked/unknown, ignored on non-apikey routes, JWT still works, lookup failure 503), admin builder tests (raw key never stored or audited), route-guard test extended (apikey routes must pass `allowApiKey: true`, others must not). `npm test` 364 pass, `tsc` clean. Not run against live Supabase.
