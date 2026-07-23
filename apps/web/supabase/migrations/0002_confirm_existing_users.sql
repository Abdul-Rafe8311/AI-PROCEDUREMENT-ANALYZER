-- One-time backfill: confirm any auth users left unconfirmed
-- (accounts created before "Confirm email" was turned off in
--  Authentication → Providers → Email). Idempotent: re-running
--  is a no-op because already-confirmed rows are excluded.
update auth.users
set email_confirmed_at = now()
where email_confirmed_at is null;
