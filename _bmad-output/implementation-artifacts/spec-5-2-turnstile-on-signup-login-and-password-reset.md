---
title: 'Story 5.2: Turnstile on signup, login and password reset'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

Signup, login and forgot-password show the shared Turnstile widget (hook `useCaptchaField`) and pass its token to Supabase as `options.captchaToken` (AD-9: no custom verifier; Supabase Auth verifies once its CAPTCHA setting is on). Submit stays disabled until a token exists. Tokens are single-use, so every failed attempt resets the widget; a captcha error focuses it; the email (and other typed fields) are preserved. Supabase `captcha_failed` maps to "Verification failed. Please try again."; a 5xx while a token was sent maps to "Verification is unavailable right now. Please try again in a moment."

## Decisions

- With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` the widget renders nothing and no token is sent, so auth keeps working before the dashboard toggle and if the env is lost.
- Enabling CAPTCHA in Supabase is a dashboard action that must follow the deploy of this code (rollout step 6); steps are in the runbook.
- The token is only added to the Supabase call when it exists.

## Verification

`captcha.test.ts` (message mapping incl. `isCaptchaMessage`), `auth-captcha-wiring.test.ts` (static: each page uses the hook, gates submit, passes the token, resets on failure; auth-context forwards `captchaToken` on all three calls; `siteverify` only in `lib/server/turnstile.ts`). `npm test` 553 pass, `tsc` clean.
