---
title: 'Story 4.6: Admin queue, viewer, decisions and history'
type: 'feature'
created: '2026-11-12'
status: 'done'
---

## Intent

`/admin` gains a Payments section with Queue and History tabs next to Users (page widened for the two-pane layout). Queue: oldest-first cards with user email, plan, expected USD amount, transaction ID, submitted time, a duplicate warning alert ("This transaction ID was used in another request ({link})"), and a receipt thumbnail loaded through a 60 s signed URL. At `lg` it is two panes (list left, selected request right); below `md` a single column ordered facts, receipt, actions. Thumbnail tap opens a full-screen viewer (image with zoom controls and native pinch, alt "Payment receipt submitted by {user}", Esc closes, "Open in new tab" for PDFs). Approve (primary) and Reject (outline, danger text) are equal size and >= 44px. Approve opens a Dialog (md+) or bottom sheet (< md, `rounded-t-2xl`, safe-area padding) restating user, plan, amount and "active from today until {date}"; focus lands on the title; one "Approve" button confirms. Reject opens the same container with a required reason textarea ("This text is emailed to the user"); "Reject" stays disabled until non-empty. A 409 `ALREADY_DECIDED` removes actions and shows "This request was already decided."; a decided card shows who and when. Empty queue reads "No payments waiting." History tab: decided requests, who/when, reason, a warning badge "Email not sent" when the decision email failed (the decision still shows as made), paginated. `Enter` opens a card, `Esc` closes viewer or confirmation, status changes announce through `aria-live="polite"`.

## Decisions

- Pure `lib/admin-queue.ts` holds copy and rules (summaries, disabled states, outcome mapping) and is unit-tested; components stay thin.
- The duplicate link jumps to that request if it is in the queue, otherwise to the History tab.
- `receiptType` ('image' | 'pdf' | null) is added to the admin DTO from the stored file extension so the viewer knows when to fall back to a new tab; the storage path itself is never sent.
- Decision responses with `emailSent: false` show "Decision saved. The email could not be sent." and the History badge keeps the warning.
- Receipt URLs expire after 60 s; the viewer fetches a fresh one each time it opens.

## Verification

Unit tests for the pure module and the DTO field. `npm test`, `tsc`, `next build`. Not viewed in a browser (no Supabase key locally); the admin API needs a deployment with the admin env vars.
