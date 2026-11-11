---
title: 'Story 4.2: Payment request API and private screenshot storage'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

Migration `0009_payment_requests.sql` (applied; the story text says 0008, which is taken) provides `payment_requests` and the private `payment-proofs` bucket. `POST /api/payments` (multipart, guard jwt): validate plan, transaction ID (1-100 printable chars) and file (PNG/JPG/PDF by magic bytes, <= 5 MB); upload with the service-role client to `<user_id>/<request_id>.<ext>`; insert with `amount_usd` copied from `PLAN_PRICES_USD` (integer only). Missing or bad fields: 400 `VALIDATION` with `fields`. Any failure before the row commits removes the object. A second pending request: 409 `PENDING_REQUEST_EXISTS` (unique index 23505), object removed. `GET /api/payments` (jwt): own history, paginated, plus the `pending` request. `GET /api/payments/[id]/screenshot` (jwt): 60 s signed URL only for the owner or an admin, else 403. A marked `TURNSTILE HOOK` is the single place Epic 5 adds verification.

## Decisions

- Logic lives in `lib/server/payments.ts` behind a `PaymentsStore` interface, with the Supabase implementation in `payments-db.ts`; tests use a fake store.
- Unknown id and not-your-request both return 403, so ids cannot be probed.
- No price configured, or a non-integer price: 503 `PAYMENTS_UNAVAILABLE`; nothing is uploaded.
- Logs carry error names only; never bank data, signed URLs or tokens.
- Not exposed to real users until Epic 5 lands (rollout order).

## Verification

Fake-store tests: validation, magic bytes (spoofed extension rejected), size limit, cleanup on insert failure and on pending conflict, owner/admin/other screenshot access, pagination clamp. Marker test updated. `npm test`, `tsc`.
