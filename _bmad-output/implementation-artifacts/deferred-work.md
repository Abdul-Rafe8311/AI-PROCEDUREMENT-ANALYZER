
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-server-verified-identity-and-route-guard-markers.md`
  summary: Demo principal is gated on NODE_ENV !== 'production'; a staging/preview deploy with custom NODE_ENV and missing Supabase env would serve jwt routes as demo user.
  evidence: Rule was set explicitly by the user; consider an explicit ALLOW_DEMO opt-in in a later story.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-server-verified-identity-and-route-guard-markers.md`
  summary: Harden config (validate JSON shape of BANK_DETAILS/PLAN_PRICES_USD, memoize failures) and import boundary (server-only package, AST parsing, route.tsx/js names).
  evidence: Reviewers showed wrong-shape JSON passes and regex-based checks can miss exotic forms; no consumers yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-server-verified-identity-and-route-guard-markers.md`
  summary: pages/api/report/export.tsx has no guard marker or classification.
  evidence: Outside app/api so the marker test skips it; spec excluded it.
