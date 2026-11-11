---
title: AI Procurement Analyzer — Subscriptions, Manual Payment & CAPTCHA
status: final
created: 2026-11-11
updated: 2026-11-11
---

# PRD: AI Procurement Analyzer — Subscriptions, Manual Payment & CAPTCHA
*Working title — confirm.*

## 0. Document Purpose

This PRD covers **three new features only** for the live AI Procurement Analyzer (`apps/web`): (1) subscription tiers with usage limits, (2) manual bank-transfer payment with admin approval, and (3) Cloudflare Turnstile CAPTCHA. It does not re-specify the existing product (extraction, scoring, TA form, comparison report, Excel export), which is documented in `AGENTS.md` and the code. Audience: the founder (PM and sole engineer), then downstream UX, architecture, and epic/story workflows. Vocabulary is anchored in the Glossary (§3); features carry globally numbered FRs; inferred items are tagged `[ASSUMPTION]` inline and indexed in §9. Implementation mechanics are in `addendum.md`.

## 1. Vision

Procurement teams at industrial companies, starting with cement plants in Saudi Arabia, receive supplier quotations as PDFs in mixed formats, currencies, and VAT rules. Comparing them by hand takes about 4.5 hours per RFQ. The product extracts and normalizes the quotes, scores suppliers (Price 40%, Delivery 25%, Payment 15%, Warranty 10%, Reliability 10%), and generates the TA form, comparison report, and Excel export in minutes. A live pilot is running with Najran Cement Company, and free trials are being offered to other cement companies.

Today every signed-in user gets everything with no limit and no way to pay. This PRD turns the product into something that can earn revenue and defend itself: a Free tier that proves value, three paid tiers that unlock more volume and the chatbox / tender sheet, a payment path that works for Saudi industrial buyers who pay by bank transfer rather than card, and bot protection on every public-facing form.

The goal for launch: a prospect can sign up, hit the Free limit, pay by transfer, and be on a paid plan within about a day, with the founder spending minutes per payment rather than hours.

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** As a procurement officer, I want to keep analyzing RFQs without hitting an unexpected wall, and to know exactly what my plan allows before I commit.
- **Functional:** As a buyer whose company pays by bank transfer, I want to pay for a plan without a credit card and get a clear answer on whether it was accepted.
- **Contextual:** As the founder-operator, I want to review and approve payments quickly from one page, and be told when something needs my attention.
- **Defensive:** As the founder, I want bots and scripted abuse kept away from signup, login, password reset, and payment so that quotas and my review queue mean something.

### 2.2 Non-Users (v1)

- Buyers wanting card payment, invoices, VAT receipts, or auto-renewing billing.
- Multi-seat teams / organization accounts (Max has no seats in v1).
- Admins other than the founder.

### 2.3 Key User Journeys

- **UJ-1. Farid's team outgrows Free.**
  - **Persona + context:** Farid, procurement engineer at a cement plant on the Free plan, processing quotation PDFs for several open RFQs near month-end.
  - **Entry state:** Signed in, Free plan, 13 of 14 PDFs used this calendar month.
  - **Path:** Uploads a quotation PDF (14 of 14) → it processes → uploads another → upload is blocked with a message that the monthly limit is reached, plus an upgrade prompt → opens Plans → compares Plus, Pro, Max.
  - **Climax:** He sees exactly what each plan adds (PDF count, chatbox, tender sheet) and the price in USD.
  - **Resolution:** He picks Pro and moves to payment (UJ-2).
  - **Edge case:** He re-analyzes an RFQ whose PDFs are already uploaded; this works and is not counted.

- **UJ-2. Farid pays by bank transfer.**
  - **Persona + context:** Same Farid; his company finance team pays by bank transfer.
  - **Entry state:** Signed in, Pro selected on the Plans page.
  - **Path:** Sees the bank details and amount (USD) → makes the transfer outside the app → returns, uploads a screenshot of the receipt and enters the transaction ID, passes the CAPTCHA, submits → sees status "Pending review".
  - **Climax:** An email arrives: "Your Pro plan is active until {date}".
  - **Resolution:** Chatbox and tender sheet are now available; quota is 45 PDFs for the next 30 days. A reminder email arrives 3 days before expiry.
  - **Edge case:** The founder rejects the request because the amount is wrong. Farid receives an email with the reason, and can submit a new request.

- **UJ-3. The founder clears the payment queue.**
  - **Persona + context:** The founder, sole admin, working across other tasks.
  - **Entry state:** Receives an email "New payment request from {user}, {plan}".
  - **Path:** Opens the admin page → sees pending requests oldest-first with user, plan, amount, transaction ID, screenshot → checks the bank statement → approves or rejects (with a typed reason).
  - **Climax:** One click, and the user is emailed and the plan is live.
  - **Resolution:** Request leaves the pending list and stays in history for audit.
  - **Edge case:** The same transaction ID is submitted twice; the second is flagged as a duplicate before the founder reviews it.

- **UJ-4. Granting the pilot customer Pro for free.**
  - **Persona + context:** The founder, with the Najran Cement pilot users signed up on Free.
  - **Entry state:** On the admin page.
  - **Path:** Finds the user → sets plan to Pro and an expiry date manually.
  - **Climax:** The user's next page load shows Pro features with no payment record needed.
  - **Resolution:** Plan falls back to Free at the expiry date like any other plan.

- **UJ-5. A bot hits the signup form.**
  - **Persona + context:** An automated script submitting signups and password resets.
  - **Path:** Submits without a valid Turnstile token → request is rejected server-side. If the verification service is unreachable, the request is also rejected.
  - **Resolution:** No account is created, no email sent. A real user in the same situation sees a clear "verification failed, try again" message.

## 3. Glossary

- **Plan** — One of Free, Plus, Pro, Max. Defines the PDF Quota and Feature Access. Every user has exactly one active Plan at any time.
- **Free** — Default Plan for every user. No chatbox, no tender sheet. Never expires.
- **Paid Plan** — Plus, Pro, or Max. Has an expiry date; reverts to Free when expired.
- **Quotation PDF** — A supplier quotation file uploaded by a user for extraction. The unit counted against the PDF Quota.
- **PDF Quota** — Maximum number of newly uploaded Quotation PDFs per Quota Period: Free 14, Plus 30, Pro 45, Max 100.
- **Quota Period** — The window over which usage is counted. Free: calendar month. Paid Plan: the 30-day cycle starting at activation.
- **Feature Access** — Which of **chatbox** and **tender sheet** a Plan allows.
- **Payment Request** — A user's submission to buy a Plan: selected Plan, payment screenshot, transaction ID. Status: Pending, Approved, or Rejected.
- **Admin** — A user whose email is in the `ADMIN_EMAILS` allowlist. In v1, the founder only.
- **Admin Page** — The page where Admins review Payment Requests and manually set a user's Plan.
- **Turnstile** — Cloudflare's CAPTCHA service. A **Turnstile Token** is the proof it issues, verified server-side.
- **Priority Support** — Max-only entitlement: an email reply from the founder within 12 hours, versus 48 hours for all other Plans. A service target, not a system-enforced SLA.
- **Support Address** — The email address (from configuration) users write to for help, refunds, and Priority Support.

### Plan matrix

| Plan | Price (USD/mo) | PDF Quota | Chatbox | Tender sheet | Priority Support |
|---|---|---|---|---|---|
| Free | 0 | 14 | No | No | No |
| Plus | 6 | 30 | Yes | No | No |
| Pro | 12 | 45 | Yes | Yes | No |
| Max | 30 | 100 | Yes | Yes | Yes |

## 4. Features

### 4.1 Subscription Tiers

**Description:** Every user has one Plan. The Plan sets the PDF Quota and Feature Access. The system counts newly uploaded Quotation PDFs against the Quota in the current Quota Period and blocks uploads at the limit with an upgrade prompt. The existing chatbox and tender-sheet features are gated by Feature Access. Realizes UJ-1, UJ-4.

**Functional Requirements:**

#### FR-1: Default and fallback to Free

Every new and existing user has the Free Plan unless an active Paid Plan applies. When a Paid Plan's expiry passes, the user returns to Free automatically. Realizes UJ-1.

**Consequences (testable):**
- A newly signed-up user's Plan is Free.
- All existing users are Free at launch, except users the Admin sets otherwise (FR-15).
- A user whose Paid Plan expiry has passed is treated as Free on their next request, with no manual step.
- Data created while on a Paid Plan (analyses, tender sheets) is retained after fallback; only access to gated features and the higher Quota is lost.

#### FR-2: Quota enforcement on upload

The system counts each newly uploaded Quotation PDF against the user's PDF Quota for the current Quota Period and blocks uploads once the Quota is used up. Realizes UJ-1.

**Consequences (testable):**
- A Free user's 15th Quotation PDF in a calendar month is blocked; the 14th succeeds.
- Blocked uploads show a message stating the limit reached, the Plan, when the Quota resets, and a link to the Plans page.
- Enforcement is server-side; a client that skips the UI check is still blocked.
- Re-analysis of an RFQ whose PDFs were already uploaded does not consume Quota.
- an upload counts once extraction succeeds; a failed extraction does not consume Quota.
- a multi-PDF upload that would exceed the remaining Quota is rejected as a whole, with the number remaining shown.

#### FR-3: Quota periods

Free usage resets on the calendar month; Paid Plan usage resets every 30 days from activation. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Free Quota resets at the start of each calendar month. month boundary is evaluated in Asia/Riyadh time.
- A Paid Plan activated on day D has Quota Periods starting D, D+30, D+60, ...
- Early renewal of the same Plan (FR-9) adds another full 30-day Quota Period after the current one ends; it does not reset the current Period's usage.
- A new Plan start (upgrade, FR-10) begins a fresh Quota Period with zero usage.

#### FR-4: Chatbox gating

Only Plus, Pro, and Max users can use the chatbox. Realizes UJ-1.

**Consequences (testable):**
- Free users see the chatbox entry point in a locked state with an upgrade prompt; the chat API returns a clear "plan required" error for them.
- Plus, Pro, and Max users have unrestricted chatbox access (no separate chat message cap in v1).

#### FR-5: Tender sheet gating

Only Pro and Max users can use the tender sheet (fill and export). Realizes UJ-1.

**Consequences (testable):**
- Free and Plus users see the tender-sheet entry point locked with an upgrade prompt; its API routes return a "plan required" error.
- Pro and Max users have full access.

#### FR-6: Plan and usage visibility

Users can see their current Plan, expiry date, PDFs used versus Quota, and next reset date, and can compare Plans. Realizes UJ-1.

**Consequences (testable):**
- Account/Plans surface shows Plan name, expiry (Paid only), "X of Y PDFs used", reset date, and the plan matrix with USD prices.
- Usage figure matches the count enforced by FR-2.

**Feature-specific NFRs:**
- Plan checks add no more than 100 ms (p95) to gated requests.

### 4.2 Manual Bank-Transfer Payment

**Description:** A user selects a Plan, sees the company bank details and the USD amount, pays outside the app, and submits a Payment Request with a screenshot and transaction ID. The Admin reviews it on the Admin Page, approves or rejects, and the user is emailed. Approval activates the Plan for 30 days. There is no auto-renew; users pay again to renew. The review expectation is 24 hours; this is a stated expectation, not enforced by the system. Realizes UJ-2, UJ-3, UJ-4.

**Functional Requirements:**

#### FR-7: Plan selection and bank details

A signed-in user can choose Plus, Pro, or Max and see the bank details and exact USD amount to transfer. Realizes UJ-2.

**Consequences (testable):**
- Bank details (account name, bank, IBAN, etc.) and prices are read from configuration, not hard-coded in source; changing them needs no code change.
- Only USD is shown. `[NON-GOAL for MVP]` SAR display.
- The page states the review expectation ("typically within 24 hours").
- The page states the refund policy: no refunds once a Plan is activated; if a payment is rejected because it cannot be verified, the user contacts the Support Address and the Admin refunds manually (outside the system).

#### FR-8: Payment Request submission

A signed-in user can submit a Payment Request containing the selected Plan, a payment screenshot, and a transaction ID, protected by Turnstile (FR-17). Realizes UJ-2.

**Consequences (testable):**
- Submission requires Plan, screenshot, and transaction ID; missing fields are rejected with field-level errors.
- screenshot accepts PNG/JPG/PDF up to 5 MB.
- The screenshot is stored privately; it is viewable only by the submitting user and Admins.
- On success the user sees status "Pending review" and the request appears in their payment history.
- A transaction ID already used on another Request is flagged as a duplicate for the Admin (it is not auto-rejected).
- a user may have one Pending Request at a time; a second is blocked until the first is decided.
- The Admin receives an email for every new Payment Request (FR-14).

#### FR-9: Renewal and early payment

A user already on a Paid Plan can pay for the same Plan early to extend it. Realizes UJ-2.

**Consequences (testable):**
- Approved early payment for the same Plan sets expiry to the current expiry + 30 days.
- Paying after expiry starts a new 30-day Period from approval time.

#### FR-10: Upgrade and downgrade

Users can switch Plans; upgrades take effect immediately, downgrades at expiry. Realizes UJ-2.

**Consequences (testable):**
- Plans rank Plus < Pro < Max. An approved Request for a higher Plan than the current one starts that Plan immediately with a fresh 30 days and fresh Quota; the remaining days of the previous Plan are forfeited (no proration).
- An approved Request for a lower Plan than the current one is queued and takes effect when the current Plan expires, starting a 30-day Period then. the user pays for the lower Plan at request time; the lower Plan's 30 days begin at the previous Plan's expiry.
- The user's Plans page shows any queued Plan and its start date.

#### FR-11: Admin review

An Admin can list, inspect, approve, and reject Payment Requests on the Admin Page. Realizes UJ-3.

**Consequences (testable):**
- The Admin Page is accessible only to users whose email is in `ADMIN_EMAILS`; everyone else gets 403/redirect, enforced server-side.
- Pending Requests list oldest-first showing user email, Plan, USD amount, transaction ID, submitted time, duplicate flag, and a viewable screenshot.
- Approve activates/extends the Plan per FR-9/FR-10 in one action.
- Reject requires a typed reason.
- Every decision records who decided and when; decided Requests remain in a history view.
- A decided Request cannot be decided again.

#### FR-12: Approval activation

Approving a Payment Request activates the Plan for 30 days. Realizes UJ-2, UJ-3.

**Consequences (testable):**
- After approval the user's next request sees the new Plan and Quota with no re-login.
- Expiry = activation + 30 days (or per FR-9 / FR-10).

#### FR-13: User emails on decision

The user is emailed when a Request is approved or rejected, using Resend. Realizes UJ-2.

**Consequences (testable):**
- Approval email states the Plan and expiry date.
- Rejection email includes the Admin's reason and how to resubmit.
- Email failure does not roll back the decision; the failure is logged and visible to the Admin.

#### FR-14: Admin notification and expiry reminder

The Admin is emailed on each new Payment Request, and users are emailed 3 days before a Paid Plan expires. Realizes UJ-3.

**Consequences (testable):**
- Admin email contains user, Plan, amount, and a link to the Admin Page.
- A reminder is sent once per Paid Plan expiry, 3 days beforehand, to the user's email. It is not sent if the plan has already been renewed beyond that window. a scheduled job runs at least daily.

#### FR-15: Manual plan override

An Admin can set any user's Plan and expiry date directly, without a Payment Request. Realizes UJ-4.

**Consequences (testable):**
- Used to give Najran Cement pilot users Pro free of charge.
- Takes effect immediately and falls back to Free at the expiry date like any Paid Plan.
- The override is recorded in the audit trail with the Admin and time.

#### FR-16: Expiry fallback

When a Paid Plan expires, the user returns to Free with no manual step. Realizes UJ-2.

**Consequences (testable):**
- If a queued lower Plan exists (FR-10), it starts instead of Free.
- Otherwise the user becomes Free, and Free usage starts from 0 for the remainder of that calendar month. Only Quotation PDFs uploaded after the expiry moment count toward the Free Quota; PDFs uploaded while on the Paid Plan do not.

#### FR-19: Priority Support for Max

Max users get email replies from the founder within 12 hours; all other users within 48 hours. Realizes UJ-1.

**Consequences (testable):**
- The Plans page states the response targets per Plan and shows the Support Address.
- The Admin Page shows each user's current Plan so a support email can be prioritized. `[ASSUMPTION:` no ticketing tool or in-app support form in v1; support is plain email.`]`
- Response times are a service commitment tracked by the founder, not enforced or measured by the system.

**Feature-specific NFRs:**
- Screenshots are stored in a private bucket with access controlled by row-level rules; no public URLs.
- Payment screenshots are retained for 12 months after submission and then deleted automatically; the Payment Request record (Plan, transaction ID, decision, timestamps) is kept after the screenshot is deleted.
- All outbound email uses a sender address from the `EMAIL_FROM` configuration so the sending domain can change without a code change.

### 4.3 Cloudflare Turnstile CAPTCHA

**Description:** Turnstile protects the four public or sensitive forms: signup, login, password reset, and the payment form. Tokens are verified server-side; the system fails closed. Realizes UJ-5, UJ-2.

**Functional Requirements:**

#### FR-17: Turnstile on four forms

Signup, login, password reset, and the payment form each require a valid Turnstile Token. Realizes UJ-5.

**Consequences (testable):**
- Each of the four forms renders the Turnstile widget and cannot be submitted successfully without a valid token.
- Server-side verification occurs on the submission; a client-side-only check is not sufficient. A missing, invalid, expired, or reused token is rejected.
- Rejected submissions show a clear, retryable message and the widget resets.

#### FR-18: Fail closed

If Turnstile verification cannot be completed (service unreachable, timeout, misconfigured secret), the submission is rejected. Realizes UJ-5.

**Consequences (testable):**
- With the verification service unreachable, signup, login, password reset, and payment submission all fail with "verification unavailable, try again".
- The failure is logged without logging secrets or tokens.

**Feature-specific NFRs:**
- Site key and secret key come from environment configuration; the secret is never exposed to the client.
- Widget works on mobile browsers and is keyboard-accessible.

## 5. Non-Goals (Explicit)

- No online payment (card, Stripe, Mada/Apple Pay) and no auto-renewing billing.
- No invoices or VAT receipts, no proration, no refunds flow.
- No multi-user seats or organization accounts.
- No SAR price display.
- No additional admins or role management beyond the `ADMIN_EMAILS` allowlist.
- No change to extraction, scoring, TA form, report, or Excel export behavior.
- No usage-based billing, overage purchase, or add-on packs.
- No per-message caps on the chatbox.

## 6. MVP Scope

### 6.1 In Scope

- Plan model, defaults, expiry fallback, quota enforcement, feature gating (FR-1 to FR-6).
- Payment request flow, Admin Page, emails via Resend, manual plan override (FR-7 to FR-16).
- Turnstile on the four forms, fail closed (FR-17, FR-18).

### 6.2 Out of Scope for MVP

- Card/online payments and auto-renew — deferred until volume justifies it.
- Priority Support tooling (ticketing, SLA timers) — v1 is plain email with a stated target.
- Admin analytics (MRR, churn) — `[NOTE FOR PM]` likely useful for the YC application; revisit.

## 7. Success Metrics

**Primary**
- **SM-1**: Free-to-paid conversion — share of users hitting the Free quota who submit a Payment Request within 14 days. Target: set after first 30 days of data. Validates FR-2, FR-7, FR-8.
- **SM-2**: Payment turnaround — median time from submission to decision. Target: under 24 hours, 90% within 24 hours. Validates FR-11, FR-14.
- **SM-3**: Paid accounts — number of active Paid Plans. Target: 3 paying customers within 60 days of launch. Validates FR-12.

**Secondary**
- **SM-4**: Bot abuse — signups failing Turnstile versus total attempts; zero bot-created accounts reaching the quota. Validates FR-17, FR-18.
- **SM-5**: Renewal rate — share of expiring Paid Plans renewed within 7 days. Validates FR-9, FR-14.

**Counter-metrics (do not optimize)**
- **SM-C1**: Rejection rate and reject-then-resubmit loops — do not optimize for approving everything quickly; correct decisions matter more than speed. Counterbalances SM-2.
- **SM-C2**: Legitimate-user CAPTCHA failure rate — do not tighten CAPTCHA at the cost of blocking real buyers on slow Saudi networks. Counterbalances SM-4.
- **SM-C3**: Lost analyses from quota blocks on first-month Najran pilot users — do not hit pilot users with limits. Counterbalances SM-1.

## 8. Open Questions

None blocking. Launch dependencies (not questions):

- **Sending domain:** the founder plans to buy `aiprocurement.app`. Until the domain is verified in Resend, `EMAIL_FROM` must be a sender Resend allows; transactional emails to arbitrary users need a verified domain before real payments are accepted.
- **Bank details and Support Address** must be set in configuration before launch.

## 9. Assumptions Index

Confirmed by the founder (2026-11-11): upload counts on extraction success; whole-batch rejection over quota; Asia/Riyadh month boundary; screenshot PNG/JPG/PDF up to 5 MB; one Pending Request per user; downgrade paid at request time and starting at expiry; daily scheduled job.

Still unconfirmed:
- §4.2 FR-19: support is plain email; no ticketing tool or in-app form in v1.
