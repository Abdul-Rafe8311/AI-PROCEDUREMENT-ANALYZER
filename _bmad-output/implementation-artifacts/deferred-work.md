
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-server-verified-identity-and-route-guard-markers.md`
  summary: Demo principal is gated on NODE_ENV !== 'production'; a staging/preview deploy with custom NODE_ENV and missing Supabase env would serve jwt routes as demo user.
  evidence: Rule was set explicitly by the user; consider an explicit ALLOW_DEMO opt-in in a later story.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-server-verified-identity-and-route-guard-markers.md`
  summary: Harden config (validate JSON shape of BANK_DETAILS/PLAN_PRICES_USD, memoize failures) and import boundary (server-only package, AST parsing, route.tsx/js names).
  evidence: Reviewers showed wrong-shape JSON passes and regex-based checks can miss exotic forms; no consumers yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-server-verified-identity-and-route-guard-markers.md`
  summary: pages/api/report/export.tsx has no guard marker or classification.
  evidence: Outside app/api so the marker test skips it; spec excluded it.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-plan-ledger-effective-plan-and-entitlements-endpoint.md`
  summary: Verify 0005 against a real Postgres (overlap rejection, voided overlap allowed, RLS select-own, no browser writes).
  evidence: migrations.test.ts only matches source text; changing the constraint or policy predicate would still pass.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-plan-ledger-effective-plan-and-entitlements-endpoint.md`
  summary: Enforce append-only on plan_periods/audit_log with a trigger and add provenance checks and audit_log indexes when writers land in Story 1.3.
  evidence: service-role code can still update or delete rows; payment rows may lack payment_request_id.


- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-plan-ledger-effective-plan-and-entitlements-endpoint.md`
  summary: Migration 0005_subscriptions.sql was applied to Supabase on 2026-11-11 (user-reported: plan_periods and audit_log exist, RLS on); the SQL-side run of cases.json is still outstanding.
  evidence: Applied and checked by the user; no SQL version of cases.json exists yet, so effective-plan cases have not been run against the database. Do it with Story 1.3's writers.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-admin-users-tab-with-manual-override.md`
  summary: Audit lookup for lastChange uses one limit(5000) query that PostgREST max-rows may truncate.
  evidence: Heavy override history could yield lastChange null for some users; unverified, settle with a per-user latest query or RPC.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-admin-users-tab-with-manual-override.md`
  summary: Admin Users UI has no component tests and no hint when results are capped at 50.
  evidence: Test runner only covers .ts; server cap MAX_USERS=50 is silent in the panel.
