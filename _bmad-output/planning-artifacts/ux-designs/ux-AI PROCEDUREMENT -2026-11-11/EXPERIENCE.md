---
name: AI Procurement Copilot — Subscriptions
status: final
created: 2026-11-11
updated: 2026-11-11
sources:
  - _bmad-output/planning-artifacts/prds/prd-ai-procurement-subscriptions-2026-11-11/prd.md
  - _bmad-output/planning-artifacts/prds/prd-ai-procurement-subscriptions-2026-11-11/addendum.md
design: DESIGN.md
---

# AI Procurement Copilot — Experience Spine (Subscriptions)

> Scope: plan tiers and usage limits, manual bank-transfer payment, admin approval, and Turnstile on four forms. Everything else in the app (upload, analysis, results) is existing and out of scope except where it hosts a new element. FR/UJ IDs refer to the PRD.

## Foundation

Responsive web, Next.js 15 App Router, Tailwind v3, hand-rolled shadcn-style components, Radix Dialog/Tabs, `sonner` toasts, `lucide-react`. English, left-to-right. [ASSUMPTION: Arabic/RTL UI is out of scope for v1; the app has no RTL support today and the PRD lists SAR display as a non-goal.] Two audiences, two primary devices: buyers on a laptop at work; the admin on a phone or laptop. Mobile is mandatory for **payment proof upload** and for the **entire admin page**. Visual identity and all tokens: `DESIGN.md`.

Tone of the whole feature: this handles money for a non-technical, busy user. Every screen answers three questions without scrolling: *what do I do, what will it cost, what happens next.*

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Header usage meter | Every signed-in page (header) | Always-visible "9 / 14 PDFs used this month"; links to Plans |
| Upload limit callout | Workspace upload zone, on blocked upload only | Explains the block (FR-2) and offers the way forward |
| Locked-feature dialog | Click on a locked Chatbox or Tender sheet control | Names the plan needed and links to Plans (FR-4, FR-5) |
| Plans | Meter, callouts, user menu "Plans" | Current plan, expiry, usage, reset date, queued plan, plan matrix, support response targets (FR-6, FR-19) |
| Pay by bank transfer | "Choose {plan}" on Plans | Bank details, exact USD amount, policies, proof submission (FR-7, FR-8) |
| Payment history | Plans, below the matrix | The user's requests with status and reject reasons |
| Admin — Queue | Admin nav item (visible only to admins) | Pending requests oldest-first, approve or reject (FR-11) |
| Admin — History | Admin tabs | Decided requests, who/when, email-failure flags |
| Admin — Users | Admin tabs | Find a user, see current plan, manual override (FR-15) |
| Signup / Login / Password reset | Existing auth pages | Gain a Turnstile widget (FR-17) |

Navigation: the Plans page is reachable in one click from the usage meter and from the user menu. Admin items appear only for accounts in the `ADMIN_EMAILS` allowlist; a non-admin hitting the admin route gets the app's standard not-found/redirect, never an "access denied" page that confirms the route exists. [ASSUMPTION]

Surface closure: every PRD need lands on a surface — quota visibility → meter + Plans; limit hit → callout; gated features → locked dialog; paying → Pay + history; reviewing → Queue; pilot grants → Users override; bot protection → four forms. Not surfaced in v1 by design: invoices, seat management, SAR, refunds, in-app support form (support is the Support Address email, FR-19).

Modal rule: at most one dialog or sheet open at a time, never stacked.

→ Composition reference: [mockups/pay-step.html](mockups/pay-step.html) (Pay step only; every other surface is built from the tables in this spec). Spines win on conflict with the mock.

## Voice and Tone

Microcopy only; visual brand lives in `DESIGN.md`. Plain, specific, calm, neutral. State facts with numbers and dates. Say what happened, what it means, what to do.

| Do | Don't |
|---|---|
| "You've used all 14 PDFs on your Free plan this month. Your allowance resets on 1 December." | "Oops! You've hit your limit 😬" |
| "This upload has 5 PDFs but you have 3 left. Remove 2, or see plans." | "Upload failed." |
| "Chatbox is included in Plus and above." | "Unlock the power of AI chat!" |
| "Send exactly $12.00 to the account below, then come back and upload your transfer receipt." | "Complete your purchase now!" |
| "We usually review within 24 hours. You'll get an email when it's decided." | "Your payment is being processed instantly." |
| "Rejected: the amount on the receipt was $10, the Pro plan is $12. You can submit a new request." | "Payment failed." |
| "Not now" | "No thanks, I don't want to save time" |
| "Your Pro plan is active until 11 Dec 2026." | "Congrats! You're now a Pro! 🎉" |
| "Verification failed. Please try again." | "Bot detected." |

Rules: no urgency or scarcity language (no "only", "last chance", countdowns), no emoji, no exclamation marks in money or limit contexts, dates always unambiguous (`11 Dec 2026`, not `12/11`), amounts always `$12.00 USD` on first mention in a payment context. Refund policy is stated in plain words before the user pays, not in a link: "Plans are not refundable once activated. If we can't verify your payment, email {Support Address} and we'll refund you manually."

## Component Patterns

Behavioral. Visual specs in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Usage meter | Header, all signed-in pages | Shows "{used} / {quota} PDFs used this month" (Paid: "this period"). Click goes to Plans. Never opens anything on its own, never animates, never changes the page layout. Turns warning tone at ≥ 80% and danger tone at 100% — a passive tint only, no popup, toast or banner is triggered by crossing a threshold. [ASSUMPTION: tint is acceptable under "show prompts only when a limit is hit or a locked feature is clicked", since it is a state of the meter, not a prompt.] |
| Upgrade callout | Inline where an upload was blocked | Appears only after a blocked upload attempt. Dismissible with "Not now"; dismissal lasts for the page session and the callout returns only on the next blocked attempt. Contains plan, reset date, and "See plans". |
| Locked-feature control | Chatbox entry, Tender sheet fill/export | Always visible, always clickable. Click opens the Locked-feature dialog: feature name, the minimum plan, a one-line benefit, "See plans" (primary) and "Close". Never auto-opens. The server also returns "plan required"; if a stale client reaches it, show the same dialog. |
| Plan card | Plans page | One button per card: "Choose {plan}" for any plan other than current; current shows disabled "Current plan". No card is preselected or visually promoted. Upgrade disclosure and downgrade disclosure appear on the Pay step before any money moves. |
| Bank details card | Pay step | Each value has a Copy button; copy confirms with an inline "Copied" for 2s and a polite live-region announcement, not a toast. Values come from config and are never editable by the user. |
| Proof upload | Pay step | Accepts PNG, JPG, PDF up to 5 MB. Shows preview or filename + size after selection with Remove. On mobile the picker offers camera and gallery. Validation is immediate and per-field: wrong type or over 5 MB errors inline with the limit stated. |
| Turnstile | Signup, login, reset, payment form | Widget loads in the form; submit is disabled until a token exists. On server rejection, show a retryable inline message and reset the widget. Never blocks keyboard focus order. |
| Payment history row | Plans page | Date, plan, USD amount, status badge; Rejected rows expand to show the reason and a "Submit a new request" action. |
| Admin request card | Admin Queue | Shows user email, plan, **expected USD amount**, transaction ID, submitted time, duplicate flag, screenshot thumbnail. Tapping the thumbnail opens the full image/PDF in a full-screen viewer with pinch/zoom on mobile. Approve and Reject at the bottom, equal size. |
| Decision confirmation | Approve and Reject | Both open one confirmation surface (Dialog on `md+`, bottom sheet below), because a decided request cannot be decided again. Approve: restates user, plan, amount, and the expiry date that will result; one "Approve" button. Reject: required reason textarea (the text is emailed verbatim to the user), with a hint line explaining that; "Reject" disabled until non-empty. [ASSUMPTION: confirm on Approve too; the PRD says approve is "one action" — this adds a confirm step inside the same flow, not a second page.] |
| Manual override | Admin Users | Pick plan, set expiry date, optional note; confirmation states the effect ("Sets Max until 30 Jan 2027, effective immediately. Falls back to Free at expiry."). Logged with admin and time. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Loading plan/usage | Header meter, Plans | `Skeleton` sized to the final element; meter shows skeleton, never "0 / 0". |
| Free, normal | Meter, Plans | "9 / 14 PDFs used this month". Plans shows "Free", no expiry, reset date (1st of next month, Asia/Riyadh). |
| Near limit (≥ 80%) | Meter | Warning tint only. No prompt. |
| At limit | Workspace upload | Upload attempt blocked server-side; callout: "You've used all {Y} PDFs on your {Plan} plan. Resets on {date}. See plans." (FR-2) |
| Batch exceeds remaining | Workspace upload | Whole batch rejected: "You selected {n} PDFs but have {r} left. Remove {n−r} or see plans." Nothing is counted. |
| Extraction failed | Workspace results | Existing error; add one line: "This didn't use any of your PDFs." (FR-3) |
| Paid, active | Plans | Plan name, "Active until {date}", usage "X of Y PDFs used", reset date. Plan matrix still visible. |
| Expiring ≤ 3 days | Plans | Inline info alert: "Your {plan} plan ends on {date}. Renew to add 30 more days." One reminder email is sent separately (FR-14). No popup. |
| Expired | Plans, meter | Plan reverts to Free, usage 0 until month end (FR-16). Plans shows a one-time info alert: "Your {plan} plan ended on {date}. You're on Free. Your data is still here." |
| Queued downgrade | Plans | Info block: "{LowerPlan} starts on {date}. You keep {CurrentPlan} until then." (FR-10) |
| Pending request | Plans, Pay | Banner: "Payment under review — submitted {time}. We usually review within 24 hours." Choosing another plan is disabled with the reason stated: "You can submit a new request once this one is decided." (FR-8) |
| Request approved | Plans, email | Plan updates on next request with no re-login (FR-12). History row shows Approved. Email: plan and expiry date. |
| Request rejected | Plans, email | History row shows Rejected with the admin's reason and "Submit a new request". Email repeats the reason and how to resubmit. |
| Submit errors | Pay form | Field-level inline errors (plan, screenshot, transaction ID, Turnstile). Form values and chosen file are kept. |
| Turnstile failed | Any of four forms | "Verification failed. Please try again." widget resets, form data preserved. Service unreachable: "Verification is unavailable right now. Please try again in a moment." (fail closed, FR-18) |
| Slow / flaky network | Proof upload | Progress indicator on the file; on failure, inline "Upload didn't finish. Your details are kept. Try again." Submit button never double-submits. [Supports SM-C2: slow Saudi networks.] |
| Duplicate transaction ID | Admin card | Warning inline alert on the card: "This transaction ID was used in another request ({link})." Not auto-rejected. |
| Email delivery failed | Admin History/card | Warning badge "Email not sent" with the decision still shown as made; user-facing status is unaffected (FR-13). |
| Empty queue | Admin Queue | "No payments waiting." and nothing else. |
| Already decided | Admin card | If another session decided it, actions disappear and the card shows the decision and who/when. Stale action returns "This request was already decided." |
| Non-admin on admin route | Admin | Standard redirect/not-found. |

## Interaction Primitives

- **Prompts are earned, not scheduled.** An upgrade prompt may appear in exactly two cases: a blocked upload, or a click on a locked control. Nothing else — not page loads, not logins, not meter thresholds, not timers — may open a dialog, toast, banner or email about upgrading. The reminder email 3 days before expiry (FR-14) is a service message about an existing paid plan, sent once.
- **No dark patterns.** No preselected plan, no countdowns or scarcity, no hidden or low-contrast dismissal, no guilt copy, no pre-ticked consent. "Not now" and "Close" always exist and always work.
- **Disclose before paying.** Upgrade forfeiture (remaining days not carried over, FR-10), downgrade timing, no-refund policy, and review time are shown on the Pay step above the submit button, not after.
- **One primary action per screen.** Pay step: "Submit payment proof". Admin card: "Approve". Dialogs: one primary.
- **Copy to clipboard** on every bank value; Copy buttons are real buttons with accessible names ("Copy IBAN").
- **Files:** drag-and-drop on desktop, tap-to-choose on mobile; one file only.
- **Keyboard:** all flows fully operable; in the admin queue `Enter` opens a card, `Esc` closes the viewer or confirmation. No custom shortcuts required.
- **Touch:** 44px minimum targets on the Pay step and across Admin.
- **Banned:** modals on page load, sticky upgrade banners, tooltips as the only carrier of essential info, auto-advancing carousels, infinite scroll in History (paginate), dialogs stacked on dialogs, hover-only actions on mobile.

## Accessibility Floor

Behavioral; visual contrast lives in `DESIGN.md`.

- WCAG 2.2 AA on all new surfaces. The existing app has light ARIA coverage, so these surfaces set the bar rather than inheriting it.
- Usage meter exposes `role="progressbar"` (or `meter`) with `aria-valuemin/max/now` and an accessible name equal to the visible text.
- Status is conveyed by text + icon + color, never color alone. Badges are read as text ("Status: Pending review").
- Status changes (copied, submit success/failure, decision recorded) announce via `aria-live="polite"`; errors via `role="alert"`.
- Every form field has a visible `Label`; errors are linked with `aria-describedby` and focus moves to the first invalid field on failed submit.
- Dialogs and sheets trap focus, restore it to the trigger on close, close on `Esc` (Radix default). The confirm button is not auto-focused for Approve; focus lands on the dialog title.
- Turnstile is keyboard-reachable, and a failed verification returns focus to the widget with the message announced.
- Screenshot viewer: image has an alt describing it ("Payment receipt submitted by {user}") and the viewer is closable by keyboard; PDF receipts offer an "Open in new tab" fallback.
- Targets ≥ 44×44 CSS px on mobile; text resizable to 200% without loss; no horizontal scroll at 320px wide.
- Respect `prefers-reduced-motion`: the meter never animates; dialogs use the inherited minimal transitions.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `≥ lg` (1024px+) | Plans: 4-column plan grid, payment step centered `max-w-2xl`. Admin Queue: two panes (list + selected request with screenshot beside facts). Header shows meter with bar. |
| `md` (768–1023px) | Plan grid 2 columns. Admin single column; confirmation is a Dialog. Meter with bar. |
| `< md` | Plan grid 1 column; "Compare plans" expands the matrix as stacked cards. Pay step: bank details first, then upload. Admin: cards only, full-width actions, confirmation as bottom sheet, screenshot opens full-screen. Meter is text-only with a thin bar beneath. Header uses the existing hamburger sheet; the meter stays outside the sheet, visible. |

Primary devices: laptop (buyers), phone or laptop (admin). Phone-first verification required for Pay step and Admin. Browsers: current Chrome and Safari including iOS Safari; Turnstile must work in mobile browsers (PRD NFR).

## Inspiration & Anti-patterns

- **Borrowed, deliberately:** the existing app's upload zone, KPI cards and inline alerts, so new surfaces look like the same product. Stripe-style plain pricing tables: price, limits and lock rows, no ribbons.
- **Rejected — "Most popular" plan highlighting and preselecting a higher tier:** steers choice; conflicts with the no-dark-patterns rule.
- **Rejected — Upgrade modals on login, on threshold, or on a timer:** the user asked for prompts only on limit hit or locked-feature click.
- **Rejected — Checkout-style fake urgency ("Offer ends in…"):** this is a bank transfer reviewed by a person; urgency would be false.
- **Rejected — Hiding locked features:** hides what the product can do and makes the first discovery a dead end; locked-but-visible is honest.
- **Rejected — Auto-approving or showing "Processing…" spinners for manual payments:** the review is human; the UI says "under review" and gives a realistic window.

## Key Flows

### Flow 1 — Farid outgrows Free (UJ-1, UJ-2) — Tuesday 10:20, Najran office, laptop

1. Farid has uploaded 13 of his 14 Free PDFs this month; the header meter has read "13 / 14 PDFs used this month" in a calm amber tint all morning, and nothing has asked him to do anything.
2. A supplier sends five quotes. He selects all five in the upload zone.
3. The upload is rejected as a batch. Inline callout in the upload zone: "You selected 5 PDFs but have 1 left. Remove 4, or see plans. Your allowance resets on 1 December." Nothing is counted. Two buttons: "See plans" and "Not now".
4. He clicks "See plans". Plans shows Free (current) beside Plus $6 / 30 PDFs, Pro $12 / 45 PDFs + tender sheet, Max $30 / 100 PDFs + priority support. No card is highlighted. He picks Pro.
5. Pay step. Page top: "Pay $12.00 USD by bank transfer". Bank details card with Copy on each value; amount in large type. Below: "1. Make the transfer 2. Upload your receipt and transaction ID 3. We review within about 24 hours and email you." Refund policy in two sentences. Because he is moving up from Free there is no forfeiture line.
6. He pays from his company's banking portal in another tab, returns, drops the receipt screenshot in the upload field, types the transaction ID, passes Turnstile, and presses "Submit payment proof".
7. **Climax:** The page changes to a calm status banner — "Payment under review. Submitted 10:41. We'll email you when it's decided." — and the history row below shows a warning-toned "Pending review" badge. He knows exactly what was sent, to whom, and what happens next, and can close the laptop and go to a meeting.
8. Next morning the email says "Your Pro plan is active until 11 Dec 2026." He opens the workspace without logging in again; the meter now reads "0 / 45", and the five PDFs go through.

Failure: receipt is 8 MB → inline "That file is 8 MB. The limit is 5 MB. Try a smaller screenshot or a PDF." and the transaction ID he typed is kept. Turnstile fails → "Verification failed. Please try again." widget resets, nothing else is cleared. Payment rejected for wrong amount → history row shows the reason, "Submit a new request" is available immediately.

### Flow 2 — The admin clears the queue (UJ-3) — Wednesday 07:50, phone, in a taxi

1. An email arrives: "New payment request from farid@…, Pro". He taps the link; he's already signed in.
2. Admin Queue shows one card, oldest-first: user email, Pro, **$12.00 expected**, transaction ID, submitted time, no duplicate flag, a thumbnail.
3. He taps the thumbnail; the receipt opens full-screen. He pinch-zooms: amount $12.00, correct beneficiary, a date from yesterday. He closes the viewer.
4. He taps Approve. A bottom sheet: "Approve Pro for farid@…? $12.00 · active from today until 10 Dec 2026." One "Approve" button, one "Cancel".
5. **Climax:** he taps Approve; the card collapses and the queue reads "No payments waiting." One thumb, under thirty seconds, no zoom-fighting on a desktop table and no ambiguity about what he just committed to. Farid gets the email.

Failure: the receipt says $10. He taps Reject, the sheet asks for a reason (hint: "This text is emailed to the user"); he writes "Receipt shows $10; Pro is $12. Send the difference or resubmit." Reject enables once text exists. The decision records even if the email fails; the card then shows "Email not sent" in History so he can follow up by hand.

### Flow 3 — Granting the Najran pilot (UJ-4) — Thursday afternoon, laptop

1. Admin opens Admin → Users, searches "najran", and sees each match with their current plan.
2. He selects a user, chooses Pro, sets the expiry to 90 days out, adds the note "Pilot".
3. The confirmation reads: "Sets Pro until 8 Feb 2027, effective immediately. Falls back to Free at expiry. Recorded in the audit log."
4. **Climax:** on confirm, the user's row updates to Pro with the expiry, and the audit entry (admin, time) appears under it. The pilot user is never shown a payment screen or a limit prompt.

### Flow 4 — A bot meets the signup form (UJ-5)

1. A script submits the signup form with no or a reused Turnstile token.
2. The server rejects it; no account is created.
3. A human who hits a transient failure sees "Verification failed. Please try again." The widget resets; their email stays filled in.
4. **Climax:** the real person re-passes the check in one tap and signs up; the script gets nothing. If Turnstile's service is down, everyone sees "Verification is unavailable right now. Please try again in a moment." and no one gets through unverified.

## Open Items

- Confirmed by owner: confirm step on Approve and Reject; amber/red meter tint; English/LTR only in v1; not-found for non-admins on admin routes.
- `[NOTE FOR UX]` Existing `Badge` hardcodes green/amber/red with no dark variants; new status badges should not copy it. Optional cleanup outside this feature.
- `[NOTE FOR UX]` Bank detail field list is not fixed by the PRD beyond "account name, bank, IBAN, etc."; the card renders whatever the config supplies.
- Not specified in the PRD: exact route names, Admin user-search layout beyond Flow 3.
