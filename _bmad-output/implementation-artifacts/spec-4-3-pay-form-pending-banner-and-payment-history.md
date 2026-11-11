---
title: 'Story 4.3: Pay form, pending banner and payment history'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

The Pay step gets the proof form under the disclosures: a dashed dropzone (one PNG/JPG/PDF, <= 5 MB; preview or filename + size with Remove; `accept` plus `capture`-friendly input so phones offer camera and gallery), a transaction ID field and one primary "Submit payment proof". Client checks mirror the server and keep the typed ID on error ("That file is 8 MB. The limit is 5 MB. ..."). Submitting shows progress, blocks double submit, and on success shows "Payment under review. Submitted {time}. We'll email you when it's decided."; a network failure shows "Upload didn't finish. Your details are kept. Try again." Server `VALIDATION` and `PENDING_REQUEST_EXISTS` errors render field-level with `aria-describedby`, `role="alert"` and focus on the first invalid field. With a pending request, Plans shows a banner and disables every "Choose" ("You can submit a new request once this one is decided."), and the Pay step shows the banner instead of the form. Payment history (paginated, no infinite scroll) lists date, plan, USD amount and a badge with word + icon (Pending warning + Clock, Approved success + CheckCircle2, Rejected danger + XCircle) using `bg-{token}/10 text-{token}`; Rejected rows expand to the reason and a "Submit a new request" link.

## Decisions

- Pure module `lib/payment-form.ts` (file check, badge map, error mapping, time format, page math) is unit-tested; components stay thin.
- No Turnstile widget yet (Story 5.1 adds it at the marked hook point).
- Dates use `11 Dec 2026` style; the submitted time is local `HH:MM`.
- After a rejected request, "Submit a new request" returns to Plans (the Choose buttons are enabled again because nothing is pending).

## Verification

Unit tests for the pure module. `npm test`, `tsc`, `next build`. Not viewed in a browser (no Supabase key locally).
