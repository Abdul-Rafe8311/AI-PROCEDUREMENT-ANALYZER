---
title: 'Story 4.1: Choose a plan and see bank details'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

Plans cards gain one button each: "Choose {plan}" (paid plans other than current, link to `/plans/pay?plan=<id>`) or a disabled "Current plan". `/plans/pay` (RequireAuth via the plans layout, `max-w-2xl` centered) shows "Pay $N.00 USD by bank transfer", the amount as the largest figure, a muted `rounded-xl` bank card of label-over-value rows from `BANK_DETAILS` (whatever fields are supplied; IBAN grouped in fours; `.nums`), a Copy button per value ("Copy IBAN", 44px, inline "Copied" for 2 s, polite live region, no toast), the 3 steps, "typically within 24 hours", refund policy in plain words with the support address, and the upgrade-forfeiture / downgrade-timing / renewal disclosure. `GET /api/billing/config` (jwt) now also returns `bank: [{key,label,value}]` parsed from `BANK_DETAILS` (already in `.env.example`; never `NEXT_PUBLIC_*`). No submit control yet: Story 4.3 adds the form below the disclosures.

## Decisions

- No new env var and no migration: `bankDetails` is already read by `config.ts`.
- `BANK_DETAILS` may be an object `{ iban: "...", bank_name: "..." }` or an array `[{label,value}]`; non-string/number or empty values are dropped; wrong shape yields `[]`.
- Without a configured price or bank rows the Pay step says payment is not available yet and shows the support address; it never invents values.
- The "ending soon" notice links "Renew" to the Pay step for the current plan (same-plan renewal appends 30 days).
- Disclosures keyed on plan rank; a downgrade or renewal date is the end of the user's last queued/current period.
- Copy uses `navigator.clipboard` and fails quietly (the value stays selectable text).

## Verification

Pure tests for `bankRows`, `groupIban`, `payHeading`, `payDisclosures`; updated billing-config test. `npm test`, `tsc`, `next build`. Not viewed in a browser (no Supabase key locally).
