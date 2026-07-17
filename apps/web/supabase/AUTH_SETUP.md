# Auth setup & operations

Email + password auth is built on **Supabase Auth**. Follow these steps once per
environment (local + production Supabase projects).

## 0. Environment variables (already present)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```
No service-role key is used by the web app.

## 1. Apply the ownership + RLS migration  ⟵ REQUIRED for Phase 2
Run `supabase/migrations/0001_auth_ownership_rls.sql` against the project:
- **Supabase dashboard → SQL Editor → paste the file → Run**, or
- `supabase db push` if you use the CLI.

It is idempotent (safe to re-run). Until it is applied, sign-in/out still works and
uploads still save **ownerless** (the app degrades gracefully); once applied,
`user_id` ownership + per-user history + RLS isolation activate automatically.

## 2. Supabase Auth settings (dashboard → Authentication)
- **Providers → Email**: keep *Email* enabled with *password* sign-in.
- **Confirm email**: turn **OFF** so a new sign-up lands straight on the dashboard
  (Farid wants no codes/clicks on normal use). If left ON, sign-up shows a
  "confirm your email" screen and the user must click the link before signing in.
  The app handles both — this only changes the sign-up UX.
- **URL Configuration → Site URL + Redirect URLs**: add every origin the app runs
  on (e.g. `http://localhost:3000`, your Vercel URL). The password-reset link
  redirects to `/reset-password`, and sign-up email confirmation (if on) to
  `/workspace`, so those origins must be allow-listed.

## 3. Phase 3 — reliable password-reset email (ACTION REQUIRED)
By default Supabase sends auth emails through its **shared SMTP**, which is
**rate-limited (only a few per hour) and frequently lands in spam** — fine for a
first test, **not** reliable for real password resets.

To make reset emails reliable, wire a real provider (**Resend** free tier):
1. Create a Resend account, verify a sending domain, create an API key.
2. Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: `<your Resend API key>`
   - Sender email: an address on your verified domain (e.g. `noreply@yourdomain`)
3. Save and send a test reset from `/forgot-password`.

> **Status: NOT configured yet — reset emails currently use the Supabase default
> and are unreliable until the SMTP step above is done.**

## Restricting sign-up to a company domain (later)
Open `src/lib/auth-policy.ts` and set `ALLOWED_SIGNUP_DOMAIN` to the domain (e.g.
`'yourcompany.com'`). That single change rejects all other addresses at sign-up.
