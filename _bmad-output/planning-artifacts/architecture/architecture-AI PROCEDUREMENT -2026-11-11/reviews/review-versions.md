# Review: technology claims in ARCHITECTURE-SPINE (Stack, AD-1, AD-9, AD-10) — 2026-11-11

Method: project files (package.json, node_modules/@supabase/auth-js 2.108.2 source, Dockerfile), npm registry, official docs (Supabase, Cloudflare, Resend, PostgreSQL), Supabase Auth Go source (raw GitHub). Spine not edited.

## Verdict
No claim is wrong. Stack versions are accurate. Two points need tightening (AD-9 siteverify/remoteip detail; AD-8 storage policy wording) and one deferred item can be closed with moderate confidence (Supabase CAPTCHA fails closed) but still deserves a one-minute smoke test.

## Stack table
| Claim | Result |
|---|---|
| Node 22, `node:22-bookworm-slim` | CONFIRMED (Dockerfile lines 2 and 17) |
| Next ^15.5.19 installed, 15.5.29 latest 15.x | CONFIRMED (installed 15.5.19; `npm view next@15 version` = 15.5.29) |
| supabase-js ^2.108.2 installed, 2.119.0 latest | CONFIRMED (installed 2.108.2; npm latest 2.119.0) |
| resend 6.38.0 | CONFIRMED current (`npm view resend version` = 6.38.0) |
| Turnstile widget script `.../turnstile/v0/api.js`, siteverify `v0` | siteverify URL CONFIRMED: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`. Widget script path not re-fetched (long-standing, standard); low risk. |

## AD-1 getUser(token)
CONFIRMED. Local auth-js source: `getUser(jwt)` with a jwt calls `_getUser(jwt)`, which does `GET {authUrl}/user` with that JWT as bearer, no session needed. Docs: "performs a network request to the Supabase Auth server", result authoritative. Works with the anon client. Notes:
- It costs one Auth round trip per API request. Against the NFR "plan check ≤100 ms p95" this is a latency risk; the budget should be stated as excluding or including this hop. `getClaims()` (local JWKS verify) exists as an option if the project uses asymmetric signing keys; not needed for correctness.
- Use a stateless server client (`persistSession: false`, `autoRefreshToken: false`) so the module-level client does not share session state across requests.

## AD-9 Supabase native CAPTCHA
- `options.captchaToken` on all three calls: CONFIRMED in installed auth-js. `signUp` (line 687 area), `signInWithPassword` (line 883 area) and `resetPasswordForEmail` (line 3648; takes `options.captchaToken`) all send `gotrue_meta_security.captcha_token`. Caveat: Supabase's docs page only shows `signUp`; the other two are confirmed from SDK source, not docs prose.
- Current code does not pass a token anywhere (`src/lib/auth-context.tsx` signIn/signUp/sendPasswordReset) — expected, this is the work to do.
- Dashboard: Settings > Authentication > Bot and Abuse Protection, provider Turnstile, secret entered in dashboard. CONFIRMED.
- Cloudflare unreachable: docs silent, but Supabase Auth source shows it fails CLOSED. Transport error/timeout (10 s default) makes `Verify` return an error; the middleware turns that into HTTP 500 "captcha verification process failed". `success:false` gives 400 `captcha_failed`; empty token gives 400 "no captcha_token found". Result: users cannot sign up, log in or reset during a Cloudflare outage (availability cost, security-safe). Residual unknown: I did not trace route registration to prove `/signup` and `/recover` both use the middleware (excerpt only showed `/token` exclusions for pkce/refresh/id_token grants; password grant is checked). Recommend closing the Deferred item as "fails closed per GoTrue source; confirm with one smoke test with a bad token". The planned fallback ("if it fails open, add server verifier") is then unnecessary. Also note: refresh_token grant skips CAPTCHA (fine, sessions keep refreshing during an outage). Requests with admin credentials skip CAPTCHA.
- Turnstile siteverify (custom path): endpoint, form or JSON body, params `secret`, `response`, optional `remoteip`, optional `idempotency_key`: CONFIRMED. Token valid 300 s, max 2048 chars. Single use is "intended", enforced eventually consistently: target is rejecting >=99% of repeats made 5+ s after first success; closely spaced reuse may still pass. Error codes `timeout-or-duplicate`, `invalid-input-response`, `internal-error`, `missing-input-secret`, `invalid-input-secret`, `bad-request`.
  - AD-9 says reuse returns 400 `CAPTCHA_FAILED`; accurate for `timeout-or-duplicate`, but single-use is NOT a hard guarantee. Do not rely on Turnstile alone for replay protection of payment submissions; the "one pending request per user" unique index (AD-6) is the real backstop. Suggest one sentence saying so.
  - Map `internal-error` (and `invalid-input-secret`/`missing-input-secret`, which are config faults) to 503 `CAPTCHA_UNAVAILABLE`, not 400. Spine says "any non-success returns 503" and "invalid, expired or reused returns 400" — these overlap; specify by error code.
  - `remoteip` is optional. Using raw `X-Forwarded-For` is a spoof/format risk (header is a comma-list, client-controlled at the first hop). Use the platform-trusted client IP (rightmost trusted hop / platform header) and omit `remoteip` if unavailable rather than sending a list. Not confirmed from docs which header the (unconfirmed) host sets, tie to the Deferred hosting decision.
  - Also check the returned `hostname` (and optionally `action`) matches expectations; absent from spine, optional hardening.

## AD-10 Resend
CONFIRMED. `npm i resend`; `new Resend(apiKey)`; `const { data, error } = await resend.emails.send({ from, to, subject, html|text|react, ... })`. `to` accepts string or array. The SDK RETURNS `{data:null,error:{message,name}}` and does not throw on API errors. Implementation must check `error` (and still wrap in try/catch for network throws) before writing `email_log.status`, otherwise failures get logged as sent. Resend also supports an `Idempotency-Key` header option; not required here (reminder dedupe is by `email_log`). Note the spine says "No ad-hoc fetch to Resend"; fine. A verified sending domain is needed for `EMAIL_FROM` other than `onboarding@resend.dev` (test address delivers only to the account owner) — an operational prerequisite worth listing.

## AD-8 Storage (adjacent to claims asked)
- Signed URL: `createSignedUrl(path, expiresIn, options)`, `expiresIn` in seconds; 60 is the docs' own example. CONFIRMED. No documented upper limit. A 60 s TTL is valid but is a link lifetime only; once fetched the browser can cache the image.
- Private bucket: uploads and reads need RLS policies; service-role key bypasses RLS ("Service keys entirely bypass RLS"). So the service-role upload and service-role signed-URL minting need no policy. CONFIRMED.
- AD-8 says "storage policies allow only the owner to read own folder". Since the app only ever reads through admin signed URLs, an owner-read policy is optional and widens exposure (a user could read their own proof directly via the browser client; harmless but contradicts "browsers never write/handle"). Either drop it or keep deliberately. If kept, the standard form is `(storage.foldername(name))[1] = auth.uid()::text` for `select` to `authenticated`. Docs example uses `owner_id`/`foldername`; both valid.
- Bucket creation inside a migration (`insert into storage.buckets ... public=false`) is plausible but not verified here; Seed note says `0005` creates the bucket.

## Advisory locks in RPCs
CONFIRMED by PostgreSQL docs: `pg_advisory_xact_lock(bigint)` or `(int,int)` is transaction-scoped and auto-released at commit/rollback; session-level `pg_advisory_lock` is not. Supabase RPCs (`supabase.rpc`) run PostgREST function calls inside one transaction, so xact-level locks work and are safe under PostgREST's pooled connections. AD-5 must specify `pg_advisory_xact_lock` (spine only says "per-user advisory lock"): a session-level lock would leak across pooled connections. Derive the key with `hashtextextended(user_id::text, 0)` (bigint). Also: the lock only serialises if reserve, count and insert occur in the same function call/transaction, which AD-5 implies. Not independently verified: PostgREST's per-request transaction behavior from its docs this session (well-known; stated from knowledge).

## Flag list
1. (Med) AD-9: Turnstile single-use is best-effort; state the unique pending index as the actual replay control.
2. (Med) AD-9: split 503/400 mapping by Cloudflare error code; `internal-error` and secret errors are 503.
3. (Med) AD-9: do not send raw `X-Forwarded-For`; use trusted client IP or omit `remoteip`.
4. (Med) AD-5: name `pg_advisory_xact_lock`, not just "advisory lock".
5. (Low) AD-10: handle `{error}` return (no throw) when writing `email_log`.
6. (Low) AD-1: note one Auth round trip per request vs the 100 ms NFR; use a non-persisting server client.
7. (Low) Deferred item on CAPTCHA outage: evidence says fail closed; downgrade to a smoke-test and document the availability impact.
8. (Low) AD-8: owner-read storage policy is unnecessary given admin-only signed URLs; decide explicitly.
9. (Info) Unconfirmed: widget script path (not re-fetched); signup/recover middleware registration (only inferred); docs prose only shows `captchaToken` for signUp (SDK source confirms the others).
