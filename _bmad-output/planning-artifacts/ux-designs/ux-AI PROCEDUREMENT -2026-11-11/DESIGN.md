---
name: AI Procurement Copilot
description: Visual identity for the subscription, payment and admin surfaces. Inherits the existing apps/web theme (Tailwind v3 + hand-rolled shadcn-style components, Inter, indigo primary); this file specifies the delta only.
status: final
created: 2026-11-11
updated: 2026-11-11
sources:
  - _bmad-output/planning-artifacts/prds/prd-ai-procurement-subscriptions-2026-11-11/prd.md
  - apps/web/src/app/globals.css
  - apps/web/tailwind.config.ts
colors:
  # Inherited from apps/web/src/app/globals.css (HSL channel vars, light values shown as approximate hex).
  # The CSS variables are the source of truth. Reference by token name, never restate in code.
  background: '#F8FAFC'
  foreground: '#0F172A'
  card: '#FFFFFF'
  muted: '#F1F5F9'
  muted-foreground: '#64748B'
  border: '#E2E8F0'
  primary: '#4046E7'
  primary-foreground: '#FFFFFF'
  success: '#1DA54F'
  warning: '#DB7706'
  danger: '#DF2A2A'
  primary-dark: '#6470F7'
typography:
  # Inherited: Inter via next/font (--font-sans), antialiased, tabular figures via .nums.
  page-title:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    letterSpacing: -0.025em
  section-title:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    letterSpacing: 0.025em
  figure:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    letterSpacing: -0.025em
rounded:
  # --radius: 0.7rem. Tailwind md = radius - 2px, sm = radius - 4px.
  sm: 6px
  md: 8px
  lg: 11px
  xl: 12px
  2xl: 16px
  full: 9999px
spacing:
  page-x: 24px
  page-y: 40px
  card-pad: 24px
  card-pad-compact: 20px
  field-gap: 6px
  form-gap: 16px
  grid-gap: 16px
components:
  usage-meter:
    height: 6px
    track: '{colors.muted}'
    fill: '{colors.primary}'
    fill-near-limit: '{colors.warning}'
    fill-at-limit: '{colors.danger}'
    radius: '{rounded.full}'
  plan-card:
    background: '{colors.card}'
    border: '{colors.border}'
    radius: '{rounded.2xl}'
    padding: '{spacing.card-pad}'
  plan-card-current:
    border: '{colors.primary}'
  status-badge:
    radius: '{rounded.full}'
  bank-details-card:
    background: '{colors.muted}'
    border: '{colors.border}'
    radius: '{rounded.xl}'
  locked-feature:
    foreground: '{colors.muted-foreground}'
  upgrade-callout:
    background: '{colors.muted}'
    border: '{colors.border}'
    radius: '{rounded.xl}'
  admin-request-card:
    background: '{colors.card}'
    border: '{colors.border}'
    radius: '{rounded.2xl}'
---

## Brand & Style

The subscription surfaces are an extension of the app that already exists, not a new brand. The existing look is clean, light, slate-neutral with a single indigo primary, Inter type, generous white cards and soft shadows. That reads as calm and professional, which is exactly the posture a product handling real money needs. This file adds no new colors, no new fonts and no decorative treatment.

Posture for this feature: **plain, exact, quiet.** Prices, bank details, amounts, dates and counts are the content; the design's job is to make them unmistakable and then get out of the way. No marketing gloss, no gradients, no urgency styling, no illustrations competing with payment instructions.

Inheritance: everything not listed in this file inherits from `apps/web/src/app/globals.css` and `apps/web/tailwind.config.ts`, including dark mode (`.dark` palette, `next-themes`). Where this file names a token, it names the token, not a literal.

## Colors

No new brand colors. The existing semantic set carries every state in this feature:

- **Primary indigo** `{colors.primary}` (`{colors.primary-dark}` in dark mode): primary actions (Pay, Submit payment proof, Approve is *not* primary-filled; see Components), the current-plan outline, the usage-meter fill in its normal state.
- **Warning** `{colors.warning}`: usage meter at or above 80% of quota, "Pending review" status, expiring-soon notices. Means "attention, not a problem yet."
- **Danger** `{colors.danger}`: usage meter at 100%, "Rejected" status, destructive confirmation, field errors.
- **Success** `{colors.success}`: "Approved" status, "Copied" confirmation, active-plan indicator.
- **Muted / muted-foreground**: bank-details panel, locked-feature labels, supporting copy, usage-meter track.

Rules:
- Status is never color alone. Every status badge carries its word ("Pending review", "Approved", "Rejected") and a lucide icon.
- Locked features are shown in `{colors.muted-foreground}` with a lock icon; they are never hidden and never in danger red. Locked is information, not an error.
- Badge colors for the three payment statuses use the semantic tokens with dark-mode variants. The current `Badge` component hardcodes `green-100/amber-100/red-100` with no dark variants; the status badge specified here must not copy that. See Components.

Avoid: a second accent color for "premium", gold or gradient plan styling, red used for anything other than rejection, limit reached, or destructive confirmation.

## Typography

All Inter, inherited. Roles used by this feature:

- `{typography.page-title}`: "Plans" page heading (`text-3xl font-bold tracking-tight`, `sm:text-4xl` on wide screens, as the existing pages do).
- `{typography.section-title}`: card and section headings ("Pay by bank transfer", "Payment history").
- `{typography.body}`: default, `text-sm`. Most of the feature is `text-sm`/`text-xs`, matching the app.
- `{typography.label-caps}`: field labels on admin cards and plan-matrix row labels (`text-xs font-medium uppercase tracking-wide text-muted-foreground`, same as the KPI label).
- `{typography.figure}`: prices and the amount to pay.

**Figures use tabular numerals (`.nums`) everywhere**: prices, amounts, IBAN groups, transaction IDs, usage counts, dates. Bank details and the exact amount to pay set at `font-mono`-free Inter with `.nums` and `tracking-wide`, grouped for reading (IBAN in groups of four). The amount to pay is the largest text in the payment step.

## Layout & Spacing

Inherited container: `mx-auto max-w-6xl px-6 py-10`, `space-y-8` between sections, `h-16` sticky header with `border-b border-border/70 bg-background/80 backdrop-blur`.

Feature-specific layout:

- **Plans page**: single column of sections inside `max-w-6xl`. Plan matrix is a 4-column grid at `lg` (`gap-4`), 2 columns at `sm`, 1 column below. The payment step is a narrower column (`max-w-2xl`, centered) so instructions read as one top-to-bottom sequence.
- **Usage meter**: lives in the header, right of the nav, left of the user menu. Small: label `text-xs`, bar 6px high, ~96px wide at `md+`. Below `md` it collapses to the text only ("9 / 14") with the bar underneath at full available width, never hidden.
- **Admin**: one column of cards at all widths up to `md`; at `lg` the queue is a two-pane layout (list left, selected request with screenshot right). Single-column order on mobile: request facts, screenshot, actions.
- **Mobile**: touch targets minimum 44px high for Approve, Reject, Copy, file picker and plan-select buttons (use `size="lg"` / `h-11`, not the default `h-10`). Horizontal page scroll is not allowed; long values (IBAN, transaction ID, email) wrap or truncate with a copy button.

## Elevation & Depth

Inherited. Cards `shadow-sm`, `hover:shadow-md` only on cards that are actually interactive (plan cards, admin request cards in the list). Dialog and sheet use the inherited `shadow-lg` over the `bg-black/50` overlay. Nothing in this feature uses shadow to signal importance; importance is expressed by order, size and the primary button.

## Shapes

Inherited. Page-level cards `rounded-2xl`, `ui/Card` `rounded-xl`, buttons and inputs `rounded-md`, badges and the usage-meter bar `rounded-full`. The bank-details panel is `rounded-xl` on a `{colors.muted}` fill so it reads as "reference information", distinct from the white form card beside it.

## Components

Inherited and used as-is: `Button` (default, outline, ghost, destructive), `Input`, `Label`, `Textarea`, `Card`, `Table`, `Dialog`, `Tabs`, `Skeleton`, `sonner` toasts, `lucide-react` icons, the inline alert patterns (error, warning, info).

New or specified-by-this-feature components (visual specs; behavior lives in EXPERIENCE.md):

- **Usage meter** (`{components.usage-meter}`): text `9 / 14 PDFs used this month` in `text-xs text-muted-foreground` with `.nums`; bar beneath or beside it. Fill `{colors.primary}`; at ≥ 80% `{colors.warning}`; at 100% `{colors.danger}`. Exposed as a progressbar to assistive tech with the text as its accessible label. Whole meter is a link to the Plans page.
- **Plan card** (`{components.plan-card}`): plan name (`section-title`), price (`figure`, "$12" with "/ month" in `text-sm text-muted-foreground`), a feature list with lucide `Check` / `Lock` rows, then one button. Current plan card gets `{components.plan-card-current}` (2px primary border) plus a "Current plan" badge. No "Most popular" or "Best value" ribbon, no pre-highlighted higher plan.
- **Plan comparison matrix**: the same data as cards in a `Table` for the "compare" view: rows PDFs per month, Chatbox, Tender sheet, Priority Support (with the 12h / 48h response targets), Price.
- **Status badge** (`{components.status-badge}`): `inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold` with icon and semantic token pair. Pending review = warning + `Clock`; Approved = success + `CheckCircle2`; Rejected = danger + `XCircle`. Defined with `bg-{token}/10 text-{token}` and a `dark:` pairing so it holds in both themes.
- **Bank details card** (`{components.bank-details-card}`): label-over-value rows (account name, bank, IBAN, any other config fields), each value with a trailing outline icon button (`Copy`, 44px target on mobile). Amount row is separated and set in `figure`. A `border-l-4 border-primary` rule is not used; the muted fill alone distinguishes the card.
- **Upgrade callout** (`{components.upgrade-callout}`): inline, in-flow block (not a modal) placed where the limit was hit. `{colors.muted}` fill, `border`, `rounded-xl`, lucide `Info`/`Lock` icon, one sentence of what happened, one sentence of what to do, a primary button "See plans" and a ghost "Not now". Same visual weight as the existing info alert.
- **Locked-feature control**: the feature's normal entry control rendered `{components.locked-feature}` with a `Lock` icon and the plan needed in a small `outline` badge ("Plus"). Stays clickable. Click opens the Locked-feature dialog (the inherited `Dialog`, `max-w-md`).
- **Proof upload field**: dashed `border-dashed border-input rounded-xl` dropzone matching the existing `upload-zone` language (icon chip `h-10 w-10 rounded-lg bg-primary/10 text-primary`), file name + size + remove after selection, inline error below in the inherited error alert style.
- **Admin request card** (`{components.admin-request-card}`): label-caps/value pairs for user email, plan, expected USD amount, transaction ID, submitted time; duplicate flag as a warning-toned inline alert; screenshot thumbnail that opens full screen. Action row: **Approve** is `default` (primary) weight; **Reject** is `outline` with danger text, never filled red. Both open a confirmation surface because a decided request cannot be undone (see EXPERIENCE.md).
- **Confirmation sheet**: `Dialog` on `md+`; on mobile the same content anchored to the bottom edge, full width, `rounded-t-2xl`, safe-area padding.
- **Turnstile widget**: rendered in its normal (managed) size inside the form, `space-y-1.5` under the last field and above the submit button, never in a modal of its own. Container reserves its height so the layout does not jump when it loads.

→ Composition reference: [mockups/pay-step.html](mockups/pay-step.html). Spines win on conflict with the mock.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Inherit `globals.css` tokens; reference them by name | Hardcode hex or Tailwind palette colors (the current `Badge` success/warning/destructive does; don't extend that) |
| Pair every status color with a word and an icon | Rely on color alone for Pending / Approved / Rejected or meter state |
| Make the amount to pay the largest text in the payment step | Bury the amount in a sentence |
| Use `.nums` for every figure, date and identifier | Mix proportional and tabular digits in a price or IBAN |
| Give Approve and Reject equal size and 44px targets on mobile | Make Reject small, grey or hard to reach to nudge approvals |
| Show locked features as clickable, muted, with a lock and the plan name | Hide gated features, or style them as errors |
| Keep upgrade callouts inline and equal in weight to info alerts | Use modals, banners, badges-with-pulse, or confetti to push upgrades |
| Show "Not now" with the same visual standing as "See plans" | Hide the dismissal, grey it out, or use guilt copy |
| Keep the meter small and text-first | Make the meter a banner, or animate it for attention |
