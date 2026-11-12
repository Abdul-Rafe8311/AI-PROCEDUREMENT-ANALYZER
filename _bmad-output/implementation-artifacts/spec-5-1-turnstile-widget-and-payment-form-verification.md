---
title: 'Story 5.1: Turnstile widget and payment-form verification'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

`lib/server/turnstile.ts` is the only code that calls Cloudflare `siteverify`. `verifyTurnstile(token, remoteIp, deps)` posts secret + token (and `remoteip` only when a trusted single IP exists) with a 5 s timeout and returns `{ ok: true }`, `{ ok: false, status: 400, code: 'CAPTCHA_FAILED' }` (`missing-input-response`, `invalid-input-response`, `timeout-or-duplicate`, or no token) or `{ ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' }` (timeout, network error, non-JSON/non-2xx, missing or invalid secret, `internal-error`, `bad-request`, any unknown code). It never fails open. `POST /api/payments` calls it through `submitPayment` after the guard and before validation or upload; the token is the multipart field `cf-turnstile-response`. Logs carry the error code only.

Client: shared `TurnstileWidget` (explicit render, `size: 'flexible'` so 320 px works, reserved 65 px height, keyboard reachable, handle with `reset()`/`focus()`), pure copy and rules in `lib/captcha.ts`, wired into `ProofForm`: submit disabled until a token exists; on `CAPTCHA_FAILED` / `CAPTCHA_UNAVAILABLE` it shows the exact messages, resets the widget, keeps the typed ID and file, and focuses the widget.

## Decisions

- `remoteip` comes only from `x-real-ip` (set by the platform on Vercel) and only if it is one valid IP; `x-forwarded-for` is client-controllable and never used.
- Missing `TURNSTILE_SECRET_KEY` is 503 in every environment (fail closed), so local demo mode cannot submit payments; Cloudflare's published test keys work for local runs.
- When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is not set in the browser the widget renders nothing and the form is not token-gated; the server still rejects (503), so this fails closed without locking the login pages (Story 5.2) if the env is missing.
- The route guard test needs no change (marker stays `jwt`).

## Verification

Mocked-fetch tests for every branch incl. timeout and abort; submitPayment tests for missing token, failure, unavailable (no upload, no insert) and pass-through; form copy tests. `npm test`, `tsc`, `next build`.
