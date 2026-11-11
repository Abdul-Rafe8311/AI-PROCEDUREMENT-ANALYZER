# Addendum: implementation notes (not requirements)

Observations from the codebase scan on 2026-11-11 (`apps/web`) to carry into architecture. Verify before relying on them.

- **Gating targets already exist:** `src/app/api/chat/route.ts`, `src/app/api/tender-sheet/{fill,export}/route.ts`, plus UI in `src/components/workspace/chat-panel.tsx` and `tender-sheet-dialog.tsx`. Upload/extraction enters via `src/app/api/extract/route.ts`.
- **Missing today:** plan/subscription tables, payment-request table, private storage bucket for screenshots, admin area, email sender (Resend), scheduled job for expiry reminders and expiry fallback. Migrations stop at `0004`; add `0005+` (never edit existing ones per AGENTS.md).
- **Config via env (never edit `.env*`, only `.env.example`):** `ADMIN_EMAILS`, bank details, plan prices, Resend key and from-address, Turnstile site and secret keys.
- **Turnstile and Supabase Auth:** Supabase Auth has native CAPTCHA protection supporting Turnstile for signup, sign-in and password reset; using it would verify server-side without a custom proxy, but must be confirmed against how the current auth pages call Supabase (client-side). Payment form needs its own server-side verification in the route handler.
- **Fail closed:** the native Supabase CAPTCHA rejects on verification failure; confirm behavior when Cloudflare is unreachable.
- **Expiry fallback:** can be computed lazily (effective plan = paid plan if `expires_at > now`, else Free) so correctness does not depend on a cron; cron only needed for reminder emails.
- **Pilot fixtures:** per AGENTS.md, never use Najran's real supplier data in test fixtures or demos.
