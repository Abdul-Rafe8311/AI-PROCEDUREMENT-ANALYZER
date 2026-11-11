---
title: 'Story 3.2: Locked-feature controls and dialog'
type: 'feature'
created: '2026-11-11'
status: 'done'
---

## Intent

Users without access see the chat panel and tender-sheet controls muted with a Lock icon and an outline badge naming the plan ("Plus" / "Pro"); still clickable, never hidden or red. Click opens `FeatureLockDialog` (Radix Dialog: focus trap, focus restore, Esc): feature name, minimum plan, one-line benefit, primary "See plans" (link to `/plans`), "Close". It never opens by itself. A 403 `PLAN_REQUIRED` from a stale client opens the same dialog, branching on `code` only. Users with access see the unchanged controls.

## Decisions

- Pure module `lib/feature-lock.ts` (copy, `isFeatureLocked`, `parsePlanRequired`) is unit-tested; UI is thin.
- Lock state comes from `useEntitlements()`; while loading or on error the controls render unlocked (no flash) and the server 403 is the backstop.
- A tiny pub/sub `lib/feature-lock-store.ts` lets non-React code (`generate.ts`, `rag-client.ts`) ask a mounted `FeatureLockHost` to open the dialog.
- Tender sheet: one locked control replaces Generate/Customize/Download when locked; a 403 during generate or download raises `PlanRequiredError`, shows the dialog and no red error text.
- Chat: a 403 shows the dialog and adds no "Something went wrong" message.

## Verification

Unit tests for the pure module. `npm test`, `tsc`, `next build`. Not viewed in a browser (no Supabase key locally).
