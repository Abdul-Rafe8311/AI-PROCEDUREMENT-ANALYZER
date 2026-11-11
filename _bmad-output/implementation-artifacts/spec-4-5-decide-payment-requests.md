---
title: 'Story 4.5: Decide payment requests: approve, reject, renew, upgrade, queue'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

SQL `decide_payment_request` (migration 0011, applied) is the only writer of payment status and `source = 'payment'` periods. `POST /api/admin/payments/[id]/decide` (guard admin) takes `{ decision: 'approve' | 'reject', reason? }`; reject without a reason is 400 `VALIDATION` before the RPC; an already decided request is 409 `ALREADY_DECIDED`; an unknown id is 404. After the transaction commits, `payment_approved` (plan, expiry date) or `payment_rejected` (reason, how to resubmit) is emailed to the user; a send failure is logged in `email_log`, returned as `emailSent: false` and never rolls back. `GET /api/admin/payments` (guard admin) lists pending oldest-first with user email, plan, USD amount, transaction ID, submitted time, derived duplicate flag (other requests with the same transaction ID) and the resulting period ("active from ... until ..." from the TS mirror `planApproval`); `?view=history&page=` lists decided requests with decider, time, reason and `emailFailed`. The next request after approval sees the new plan (no cache, Story 3.1). A queued plan shows on Plans via the existing `queued` list. `cases.json` renewal / upgrade-with-queue / queued downgrade / after-expiry scenarios are asserted against the TS mirror (done with the migrations).

## Decisions

- Logic in `lib/server/payments-admin.ts` over an injected store; Supabase implementation in `payments-admin-db.ts`.
- `emailFailed` means a decision email exists for the request, none was sent, and at least one failed.
- Duplicate flag lists the other request ids, so Story 4.6 can link to them.
- A decision email needs the user's address from Auth; if it cannot be found the decision stands and `emailSent` is false.
- The SQL side of `cases.json` is run by hand in the Supabase SQL editor (no CI), as the spine says.

## Verification

Fake-store tests: approve, reject with and without reason, already decided, not found, email failure not rolling back, ordering, duplicate flags, resulting period preview for renewal and upgrade, history flags. Marker test updated. `npm test`, `tsc`.
