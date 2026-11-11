---
title: 'Story 4.4: Email module and admin new-request notification'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

`lib/server/email.ts` (new dependency `resend` 6.38.0, migration `0010_email_log.sql` applied) exposes `sendEmail(template, to, data, opts)` over the closed set `payment_submitted_admin`, `payment_approved`, `payment_rejected`, `expiry_reminder`. Sender is `EMAIL_FROM`; Resend is called only here. Every attempt writes an `email_log` row (`pending` then `sent` or `failed` with a short error). The Resend SDK returns `{ data, error }` without throwing on API errors, so `error` is checked and recorded as failed. `sendEmail` never throws and never affects the HTTP outcome. Templates are rendered by pure `email-templates.ts` (subject, text, HTML with escaped values). After a payment request commits, `POST /api/payments` emails every address in `ADMIN_EMAILS` the user, plan, USD amount and a link to the Admin Page (`SITE_URL/admin`); a failure never removes the stored object or changes the request.

## Decisions

- One email per admin address, so each has its own `email_log` row and failure shows per recipient.
- Missing `RESEND_API_KEY` or `EMAIL_FROM` is recorded as a failed attempt with "email not configured"; it does not throw.
- User-provided values (email, transaction text, reject reason) are HTML-escaped; the plain-text part carries the same content.
- Logs and `email_log.error` never contain the API key or message bodies.

## Verification

Tests with a mocked Resend client: success, response carrying `error` (logged failed, no throw), thrown network error, unknown template refused, missing config, escaping, one row per recipient, admin notification skips when `ADMIN_EMAILS` is empty, post-commit failure leaves the 201. `npm test`, `tsc`.
