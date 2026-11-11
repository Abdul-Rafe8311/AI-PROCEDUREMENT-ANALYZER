
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

