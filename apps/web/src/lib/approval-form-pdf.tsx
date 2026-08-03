'use client';

// Second, separate PDF: a pre-filled copy of the buyer's own "Technical Approval
// Form", generated on demand (dynamically imported on click). Every fillable
// field comes from the REAL extracted data — anything not present is left BLANK.
//
// Layout (matches the buyer's reference): the PR item's OWN description + qty are
// the leftmost reference columns; then EACH supplier has their own column-group
// showing THEIR own quoted description, qty and unit price side by side for that
// same PR item row. 5+ suppliers wrap into stacked blocks; each keeps its own
// currency. Values are shown as PLAIN TEXT — the form deliberately does NOT
// highlight a best/lowest value; the human reviewer decides.
//
// Technical Comments are AI-SUGGESTED, never silently asserted: a suggestion is
// rendered visually distinct (indigo, italic, "AI SUGGESTED — REVIEW" tag) until
// a human edits it in the UI (which flips it to a plain, human-entered comment).
// Item-description match alone is never grounds for approval — the human still
// decides accept/reject and the reason.
//
// Signature blocks are provided by the caller (user-configured): count, names
// and order vary per document — nothing is hardcoded.

import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { scoreSuppliers } from './analysis-engine';
import { type FxRates, getFxRates, sarPerUnit, toSar, toUsd } from './fx-rates';
import {
  buildApprovalFields,
  resolvePrDescription,
  suggestDeliveryTimes,
  suggestOrigins,
  suggestTechnicalComments,
  suggestWarranties,
} from './item-matching';
import { buildComparisonModel, supplierGroups } from './pr-comparison';
import { applyItemReview, type ItemReview, type ReviewedValue, valueOf } from './item-review';
import { trimSupplierDescription } from './supplier-desc';
import * as LAYOUT from './approval-form-layout';
import {
  type AnalysisResult,
  type ApprovalFieldValue,
  DEFAULT_SIGNATURE_ROLES,
  DEFAULT_WEIGHTS,
  deliveryNormalizedHint,
  type ExtractedQuotation,
  type TechnicalComment,
} from './workspace-types';
import {
  headerLabel,
  resolveMoneyLines,
  TA_CURRENCY_DISPLAY_DEFAULT,
  type TaCurrencyDisplay,
  type TaCurrencySelection,
} from './ta-currency';

const C = {
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#334155',
  border: '#cbd5e1',
  head: '#e2e8f0',
  specDiff: '#b45309', // amber-700 — factual "spec differs" grade-mismatch flag
  aiBg: '#eef2ff',
  aiBorder: '#6366f1', // indigo — AI-suggested (system-generated) content only
};

// The currency choice lives in its own pure module so the .xlsx exporter — which
// runs in the Node route and must not pull react-pdf in — can read it too.
export { TA_CURRENCY_DISPLAY_DEFAULT, type TaCurrencyDisplay } from './ta-currency';

export interface ApprovalFormOptions {
  /** ordered, enabled signature-block role names (defaults to DEFAULT_SIGNATURE_ROLES) */
  signatureRoles?: string[];
  /** per-supplier Technical Comments keyed by quotation id (AI-suggested unless a human edited it) */
  technicalComments?: Record<string, TechnicalComment>;
  /** per-supplier Warranty field (toggle + AI-prefilled value) keyed by quotation id */
  warranties?: Record<string, ApprovalFieldValue>;
  /** per-supplier Country of Origin field (toggle + AI-prefilled value) keyed by quotation id.
   *  This is the GOODS' origin, and may read "Item #1 (China), Item #2 (Germany)"
   *  when one offer mixes them. DISPLAY-ONLY — the VAT local/international rule
   *  reads the supplier's own registered country, so editing this never moves VAT. */
  countriesOfOrigin?: Record<string, ApprovalFieldValue>;
  /** SAR/USD rate override; when omitted a live rate is fetched (cached fallback). null = no rate */
  fx?: FxRates | null;
  /** the human's chosen supplier — printed as the Final Recommendation (never AI-written) */
  selectedSupplier?: string | null;
  /** reviewer edits to the comparison table (description / qty / unit price per cell).
   *  The form prints `edited ?? extracted` — see item-review.ts. */
  itemReview?: ItemReview;
  /** reviewer edit to a supplier's printed NAME, keyed by quotation id. Same audit
   *  trail as every other reviewed field: `{ original, edited }`, and the form
   *  prints `edited ?? original`. DISPLAY-ONLY — scoring, matching and the
   *  recommendation all keep using the extracted name. */
  supplierNames?: Record<string, ReviewedValue>;
  /** reviewer edit to the PR Description header field (`edited ?? original`). */
  prDescription?: ReviewedValue;
  /** which currencies to print, separately for line items and totals — see
   *  ta-currency.ts. Omitted = the long-standing behaviour: line items as quoted,
   *  totals in quoted + SAR + USD. */
  currencyDisplay?: TaCurrencyDisplay;
  /** Overlay editable AcroForm fields on the rendered layout. OFF by default: the
   *  form is a flat, printable document and all editing happens in the Customize
   *  form modal beforehand. Kept so a fillable build stays one option away. */
  fillable?: boolean;
}

// Page geometry lives in the shared layout module so the pdf-lib field overlay
// places its widgets on exactly the columns this renderer draws.
const { SUP_PER_GROUP, USABLE, PAGE_PAD_X, PAGE_PAD_Y, FS, IDX_W, PR_DESC_W, QTY_L_W, UOM_W, LEFT_W } = LAYOUT;

/** Gutter between signature blocks — used for BOTH the width maths and the style. */
const SIGN_GAP = LAYOUT.SIGN_BOX_GAP;

const plain = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US');
// Money with 2 decimals + thousands separators (SAR/USD on the TA form).
const money2 = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? null
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A LINE-ITEM price, in the currency the supplier actually quoted — never
 * converted.
 *
 * Line items and totals are deliberately treated differently. A unit price is
 * something the buyer checks against the supplier's own quotation, so it has to
 * read exactly as it does there: an EUR offer shows EUR 2.42, not the SAR figure
 * it becomes at today's rate. Converting every line also silently restates the
 * whole grid whenever the rate moves, so two copies of the same form printed a day
 * apart disagree on numbers the supplier never changed.
 *
 * Only the TOTAL converts (see MoneyDual) — that is where the cross-offer
 * comparison actually happens, and it carries the rate + timestamp stamp that
 * makes the conversion auditable.
 */
function MoneyQuoted({
  amount,
  currency,
  fx,
  selection,
}: {
  amount: number | null | undefined;
  currency: string;
  fx: FxRates | null;
  selection: TaCurrencySelection;
}) {
  const lines = resolveMoneyLines(amount, currency, fx, selection);
  if (!lines.length) return <Text> </Text>;
  // First line at full size, any additional currency muted beneath it — so the
  // default (original only) renders exactly as it always has.
  return (
    <>
      {lines.map((l, i) => (
        <Text
          key={l.code}
          style={
            i === 0
              ? { textAlign: 'right', color: C.ink }
              : { textAlign: 'right', color: C.muted, fontSize: LAYOUT.TYPE.priceUsd }
          }
        >
          {`${l.code} ${money2(l.amount)}`}
        </Text>
      ))}
    </>
  );
}

// TOTALS are normalized to SAR (primary) + USD (secondary) at the live rate, so
// offers in different currencies can be compared. If the rate is unavailable OR
// the currency is unknown to the feed, we disclose the original amount instead of
// inventing a conversion.
function MoneyDual({
  amount,
  currency,
  fx,
  selection,
}: {
  amount: number | null | undefined;
  currency: string;
  fx: FxRates | null;
  selection: TaCurrencySelection;
}) {
  const lines = resolveMoneyLines(amount, currency, fx, selection);
  if (!lines.length) return <Text> </Text>;
  // The SAR figure is the one the offers are compared on, so it carries the
  // emphasis when it is present; otherwise the first line does. Duplicate
  // suppression happens in the resolver — a USD quote showing {original, USD} used
  // to print "USD 148,265 / USD 148,265", the same figure twice.
  const primary = lines.find((l) => l.code === 'SAR') ?? lines[0];
  return (
    <>
      {lines.map((l) =>
        l === primary ? (
          <Text key={l.code} style={{ fontFamily: 'Helvetica-Bold', color: C.ink, textAlign: 'right' }}>
            {`${l.code} ${money2(l.amount)}`}
          </Text>
        ) : l.code === 'USD' ? (
          <Text key={l.code} style={{ color: C.muted, textAlign: 'right', fontSize: LAYOUT.TYPE.priceUsd }}>
            {`${l.code} ${money2(l.amount)}`}
          </Text>
        ) : (
          <Text key={l.code} style={{ color: C.body, textAlign: 'right' }}>
            {`${l.code} ${money2(l.amount)}`}
          </Text>
        ),
      )}
    </>
  );
}

// One-line rate stamp for the form header (their "SAR Currency conversion rate"
// cell). Shows USD plus every non-SAR supplier currency, and whether the rate is
// live or served from cache (with its timestamp).
function fxStampText(fx: FxRates, currencies: string[]): string {
  const uniq = Array.from(new Set(['USD', ...currencies.map((c) => c.toUpperCase())])).filter((c) => c !== 'SAR');
  const bits = uniq
    .map((c) => {
      const v = sarPerUnit(c, fx);
      return v == null ? null : `1 ${c} = ${v.toFixed(4)} SAR`;
    })
    .filter((b): b is string => !!b);
  let when = fx.asOf;
  const d = new Date(fx.asOf);
  if (!Number.isNaN(d.getTime())) {
    when = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return `${bits.join('   ·   ')} — rate as of ${when} (${fx.live ? 'live' : 'cached'})`;
}

// AI-SUGGESTED recommendation shown as a clearly-labelled, visually-separate block
// (indigo/italic, "NOT an approval"). It never writes into the human Technical
// Comments / Final Recommendation fields — those stay blank for the team to sign.
function aiRecommendation(analysis: AnalysisResult, fx: FxRates | null): string {
  const scored = scoreSuppliers(analysis.quotations, analysis.risks, DEFAULT_WEIGHTS);
  const best = scored[0];
  if (!best) return '';
  const name = best.quotation.supplierName;
  const rec = analysis.recommendation;
  const bits: string[] = [];
  if (rec.lowestCost?.supplier === name && best.quotation.totalCost != null) {
    const sar = fx ? toSar(best.quotation.totalCost, best.quotation.currency, fx) : null;
    const cost = sar != null ? `SAR ${money2(sar)}` : `${best.quotation.currency} ${money2(best.quotation.totalCost)}`;
    bits.push(`lowest total cost (${cost})`);
  }
  if (rec.fastestDelivery?.supplier === name && best.quotation.deliveryDays != null) {
    const del = best.quotation.deliveryRaw?.trim() || `${best.quotation.deliveryDays} days`;
    bits.push(`faster delivery (${del})`);
  }
  const reason =
    bits.length > 0
      ? bits.join(' and ')
      : analysis.quotations.length === 1
        ? `only supplier analyzed; procurement score ${Math.round(best.overall * 100)}/100`
        : `highest procurement score (${Math.round(best.overall * 100)}/100)`;
  return `${name} — ${reason}.`;
}

// The with-VAT rule now lives in workspace-types so the PDF, the .xlsx and the
// legacy AcroForm build cannot drift apart. Re-exported here because this is where
// callers (and the acceptance tests) have always imported it from.
export { withVatAmount } from './workspace-types';

function ApprovalDocument({
  analysis,
  signatureRoles,
  comments,
  warranties,
  origins,
  fx,
  selectedSupplier,
  itemReview,
  supplierNames,
  prDescription,
  currencyDisplay,
}: {
  analysis: AnalysisResult;
  signatureRoles: string[];
  comments: Record<string, TechnicalComment>;
  warranties: Record<string, ApprovalFieldValue>;
  origins: Record<string, ApprovalFieldValue>;
  fx: FxRates | null;
  selectedSupplier: string | null;
  itemReview?: ItemReview;
  supplierNames?: Record<string, ReviewedValue>;
  prDescription?: ReviewedValue;
  currencyDisplay: TaCurrencyDisplay;
}) {
  const qs = analysis.quotations;
  const qById = new Map(qs.map((q) => [q.id, q]));
  // Show a Warranty / Country of Origin row only if AT LEAST ONE supplier has that
  // field toggled ON; if OFF for everyone the row is omitted entirely. (Within a
  // shown row, a supplier toggled OFF gets a blank cell.)
  const showWarranty = qs.some((q) => warranties[q.id]?.enabled);
  const showOrigin = qs.some((q) => origins[q.id]?.enabled);
  // prOnly: rows come ONLY from the PR document — the TA form NEVER builds rows
  // from supplier descriptions (no supplier-union fallback, no 23-row explosion).
  // Extracted grid, then the reviewer's edits folded on top: what the buyer signed
  // off in the dialog is what the form prints.
  const reviewed = applyItemReview(
    buildComparisonModel(qs, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx }),
    itemReview,
    fx,
  );
  const model = reviewed.model;
  // Total Price without VAT: the reviewer's own arithmetic wins over the extracted
  // total for any supplier they edited, so the printed total always agrees with the
  // printed lines (freight included). Untouched suppliers keep their stated total.
  const totalOf = (q: ExtractedQuotation) => reviewed.totals[q.id] ?? q.totalCost;
  const ai = aiRecommendation(analysis, fx);
  const supplierCurrencies = qs.map((q) => q.currency);
  // Per-item aware lead times — one value when the offer shares one, else
  // "Item #1 (2 weeks), Item #2 (6 weeks)". See per-item-field.ts.
  const deliveries = suggestDeliveryTimes(qs);

  const pr = analysis.purchaseRequisition;
  const prNumber = pr?.requestNo ?? qs.find((q) => q.prNumber)?.prNumber ?? '';
  // What's being procured: the PR header "Description"/"Subject" field when present,
  // else DERIVED from the item table (single-item PRs carry the subject in the item
  // description — e.g. PR 12601707's conversion kit). Blank only if truly absent.
  // The reviewer's own wording wins when they edited it in the Customize dialog.
  // Clearing the box is respected — the header then prints "Not provided", the same
  // as it does for a requisition that genuinely carries no subject. (Same as
  // Warranty / Country of Origin: a human clear is a decision, not a mistake.)
  const prSubject = prDescription ? valueOf(prDescription).trim() : resolvePrDescription(pr);
  // A supplier's printed name is `edited ?? extracted`, but a BLANK edit falls back
  // to the extracted name rather than printing an unlabelled column — an anonymous
  // price column on a signed form is never what the reviewer meant.
  const nameOf = (quotationId: string, extracted: string) => {
    const rv = supplierNames?.[quotationId];
    const v = rv ? valueOf(rv).trim() : '';
    return v || extracted;
  };
  // PDF creation date — auto-fills BOTH the TA Date field and the "Generated on"
  // note (and footer), per the company form (TA Date = the date the form was
  // produced for approval).
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const indexed = model.suppliers.map((s, i) => ({ ...s, colIndex: i }));
  const groups = supplierGroups(indexed, SUP_PER_GROUP);
  const fs = FS;

  const s = StyleSheet.create({
    page: { paddingVertical: PAGE_PAD_Y, paddingHorizontal: PAGE_PAD_X, fontSize: fs, color: C.body, fontFamily: 'Helvetica' },
    title: { textAlign: 'center', fontSize: LAYOUT.TYPE_TITLE, fontFamily: 'Helvetica-Bold', color: C.ink, letterSpacing: 0.5, marginBottom: 4 },
    subNote: { textAlign: 'center', fontSize: fs - 0.5, color: C.muted, marginBottom: 4 },
    metaRow: { flexDirection: 'row', borderWidth: 1, borderColor: C.line },
    metaCell: { paddingVertical: 2.5, paddingHorizontal: 5, borderRightWidth: 1, borderRightColor: C.line },
    descRow: { flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: C.line, marginBottom: 6 },
    descCell: { flex: 1, paddingVertical: 2.5, paddingHorizontal: 5 },
    metaLabel: { fontFamily: 'Helvetica-Bold', color: C.ink },
    faintVal: { color: C.faint, fontFamily: 'Helvetica-Oblique' },
    blockLabel: { fontSize: fs, fontFamily: 'Helvetica-Bold', color: C.muted, marginTop: 6, marginBottom: 2 },
    rowFlex: { flexDirection: 'row' },
    cellBox: { borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 2, paddingHorizontal: 3, justifyContent: 'center' },
    headCell: { backgroundColor: C.head, fontFamily: 'Helvetica-Bold', color: C.ink },
    supHead: { backgroundColor: C.head, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 2.5, paddingHorizontal: 3 },
    supNo: { fontFamily: 'Helvetica-Bold', color: C.muted, fontSize: LAYOUT.TYPE.ref, letterSpacing: 0.4 },
    supName: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: LAYOUT.TYPE.supplierName },
    ref: { color: C.muted, fontSize: LAYOUT.TYPE.ref },
    subLabel: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs - 0.5 },
    labelRow: { fontFamily: 'Helvetica-Bold', color: C.ink },
    notQuoted: { color: C.faint, fontFamily: 'Helvetica-Oblique' },
    specDiffTag: { fontSize: LAYOUT.TYPE.specDiff, fontFamily: 'Helvetica-Oblique', color: C.specDiff, marginTop: 1.5 },
    aiBox: { marginTop: 6, borderWidth: 1, borderColor: C.aiBorder, backgroundColor: C.aiBg, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 7 },
    aiLabel: { fontSize: fs - 0.5, fontFamily: 'Helvetica-Bold', color: C.aiBorder, marginBottom: 2 },
    aiText: { color: C.aiBorder, fontFamily: 'Helvetica-Oblique' },
    finalRow: { marginTop: 7, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    signWrap: { marginTop: 8, flexDirection: 'column', gap: SIGN_GAP },
    signRow: { flexDirection: 'row', gap: SIGN_GAP },
    signBox: { borderWidth: 1, borderColor: C.line, borderRadius: 3, paddingVertical: 6, paddingHorizontal: LAYOUT.SIGN_BOX_PAD, minHeight: LAYOUT.SIGN_BOX_MIN_H },
    signTitle: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs, marginBottom: 3 },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 3 },
    box: { width: 10, height: 10, borderWidth: 1, borderColor: C.line },
    sigLine: { marginTop: 5, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 2, color: C.muted },
    footer: { position: 'absolute', bottom: 10, left: 16, right: 16, alignItems: 'center' },
    footerLine: { fontSize: LAYOUT.TYPE_FOOTER, color: C.faint, textAlign: 'center' },
  });

  // Signature blocks are laid out as EXPLICIT rows of at most 4, not a flex-wrap
  // run: a wrapping run is one tall View that react-pdf will happily break mid-box
  // across a page, which is what left the 5th block (E&I / Electrical Engineer)
  // stranded and stripped the "Date:" line off the blocks above it. Each row — and
  // each box inside it — is `wrap={false}`, so a block is either wholly on this
  // page or wholly on the next, always with its Approved/Denied, Signature and Date
  // lines together.
  const perRow = Math.min(signatureRoles.length || 1, 4);
  const signW = (USABLE - (perRow - 1) * SIGN_GAP) / perRow;
  const signRows: string[][] = [];
  for (let i = 0; i < signatureRoles.length; i += perRow) signRows.push(signatureRoles.slice(i, i + perRow));

  const idxW = IDX_W;
  const prDescW = PR_DESC_W;
  const qtyLW = QTY_L_W;
  const uomW = UOM_W;
  const leftW = LEFT_W;

  return (
    <Document title="Technical Approval Form" author="AI Procurement Copilot">
      <Page size={LAYOUT.PAGE_SIZE} orientation="landscape" style={s.page} wrap>
        <Text style={s.title}>TECHNICAL APPROVAL FORM</Text>
        {/* The item rows are anchored to the PR document. This note shows ONLY when
            the requisition produced no line items (the grid can't be built) — never
            when PR items exist. It is not the old supplier-union banner. */}
        {!model.hasPr && (
          <Text style={s.subNote}>
            No Purchase Requisition line items were found — attach the PR document (with its item rows) to populate the grid.
          </Text>
        )}

        {/* Compact form-style header block. Top row: TA Date (auto-filled with the
            PDF generation date) · PR# · Generated on. Then the PR Description row.
            The approver's name/signature is captured by the per-role signature
            blocks at the foot of the form, so there is no separate "Reviewed By" row. */}
        <View style={s.metaRow}>
          <Text style={[s.metaCell, { width: 200 }]}>
            <Text style={s.metaLabel}>TA Date: </Text>
            {generatedOn}
          </Text>
          <Text style={[s.metaCell, { width: 200 }]}>
            <Text style={s.metaLabel}>PR#: </Text>
            {prNumber || <Text style={s.faintVal}>Not provided</Text>}
          </Text>
          <Text style={[s.metaCell, { flex: 1, borderRightWidth: 0 }]}>
            <Text style={s.metaLabel}>Generated on: </Text>
            {generatedOn}
          </Text>
        </View>
        <View style={[s.descRow, { borderTopWidth: 0, marginBottom: 0 }]}>
          <Text style={s.descCell}>
            <Text style={s.metaLabel}>PR Description: </Text>
            {prSubject || <Text style={s.faintVal}>Not provided</Text>}
          </Text>
        </View>
        {/* SAR conversion rate — every amount below is shown in SAR + USD at this
            LIVE rate (cached rate used, and labelled, if the feed is unreachable). */}
        <View style={[s.descRow, { borderTopWidth: 0, marginBottom: 6 }]}>
          <Text style={s.descCell}>
            <Text style={s.metaLabel}>SAR conversion rate: </Text>
            {fx ? (
              fxStampText(fx, supplierCurrencies)
            ) : (
              <Text style={s.faintVal}>
                live rate unavailable and none cached — amounts shown in each supplier&apos;s original currency
              </Text>
            )}
          </Text>
        </View>

        {groups.map((group, gi) => {
          const n = group.length;
          const { supW, desc: subDescW, qty: subQtyW, price: subPriceW } = LAYOUT.supplierSubCols(n);
          // Every cell in a PR row is normalised to that row's unit; when the whole
          // requisition shares one unit we can state it once in the header.
          const prUnits = [...new Set(model.rows.filter((r) => r.kind !== 'charge').map((r) => (r.uom ?? '').trim()).filter(Boolean))];
          const unitBasis = prUnits.length === 1 ? prUnits[0] : null;

          return (
            <View key={gi} wrap={false}>
              {groups.length > 1 && (
                <Text style={s.blockLabel}>
                  Suppliers {group[0].colIndex + 1}–{group[group.length - 1].colIndex + 1} of {model.suppliers.length}
                </Text>
              )}

              {/* Header band */}
              <View style={s.rowFlex}>
                <Text style={[s.cellBox, s.headCell, { width: idxW, borderLeftWidth: 1, borderLeftColor: C.line, borderTopWidth: 1, borderTopColor: C.line }]}>#</Text>
                <Text style={[s.cellBox, s.headCell, { width: prDescW, borderTopWidth: 1, borderTopColor: C.line }]}>
                  {model.hasPr ? 'PR Item Description' : 'Item Description'}
                </Text>
                <Text style={[s.cellBox, s.headCell, { width: qtyLW, borderTopWidth: 1, borderTopColor: C.line }]}>Qty</Text>
                <Text style={[s.cellBox, s.headCell, { width: uomW, borderTopWidth: 1, borderTopColor: C.line }]}>UOM</Text>
                {group.map((sup) => {
                  // Approvers discuss the form out loud ("supplier two is cheaper
                  // but slower"), so every column carries a stable number as well
                  // as the company name. The number is the supplier's position in
                  // the whole analysis — NOT its position in this block — so it
                  // stays the same when 5+ suppliers wrap onto a second page.
                  const supNo = sup.colIndex + 1;
                  return (
                    <View key={sup.quotationId} style={[s.supHead, { width: supW }]}>
                      <Text style={s.supNo}>{`SUPPLIER #${supNo}`}</Text>
                      <Text style={s.supName}>{nameOf(sup.quotationId, sup.supplier)}</Text>
                      <Text style={s.ref}>{sup.reference ? `REF# ${sup.reference}` : 'REF# —'}</Text>
                      <View style={[s.rowFlex, { marginTop: 2 }]}>
                        <Text style={[s.subLabel, { width: subDescW }]}>Description</Text>
                        <Text style={[s.subLabel, { width: subQtyW, textAlign: 'center' }]}>Qty</Text>
                        {/* The header names exactly what the cells below print,
                            for whatever combination the reviewer chose — it is
                            derived from the same resolver, so "(EUR)" can never
                            sit above SAR figures, and "(EUR / SAR)" appears only
                            when both are really printed. */}
                        <Text style={[s.subLabel, { width: subPriceW, textAlign: 'right' }]}>
                          {(() => {
                            const cur = headerLabel(sup.currency, fx, currencyDisplay.lineItems);
                            return unitBasis ? `Unit Price / ${unitBasis} (${cur})` : `Unit Price (${cur})`;
                          })()}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Item rows */}
              {model.rows.map((r) => {
                return (
                <View key={`${r.kind}-${r.index}-${r.label}`} style={s.rowFlex} wrap={false}>
                  <Text style={[s.cellBox, { width: idxW, borderLeftWidth: 1, borderLeftColor: C.border, textAlign: 'center' }]}>
                    {r.kind === 'charge' ? '' : r.index}
                  </Text>
                  <Text style={[s.cellBox, { width: prDescW }]}>
                    {r.label}
                    {r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}
                  </Text>
                  <Text style={[s.cellBox, { width: qtyLW, textAlign: 'center' }]}>{plain(r.qty)}</Text>
                  <Text style={[s.cellBox, { width: uomW, textAlign: 'center' }]}>{r.uom ?? ''}</Text>
                  {group.map((sup) => {
                    const cell = r.cells[sup.colIndex] ?? null;
                    // A requisition/product row with no cell means the supplier truly
                    // did not quote it → "Not Quoted" (never a silent blank). Charge
                    // rows simply omit the charge, so they stay blank.
                    const notQuoted = !cell && r.kind !== 'charge';
                    return (
                      <View key={sup.quotationId} style={[s.rowFlex, { width: supW, borderRightWidth: 1, borderRightColor: C.line }]}>
                        <View style={[s.cellBox, { width: subDescW, borderRightWidth: 1, borderRightColor: C.border }]}>
                          <Text style={notQuoted ? s.notQuoted : undefined}>
                            {cell?.description
                              ? trimSupplierDescription(cell.description, r.label)
                              : notQuoted
                                ? 'Not Quoted'
                                : ''}
                          </Text>
                          {cell?.foc && (
                            <Text style={s.specDiffTag}>FOC — supplied free of charge, no cost</Text>
                          )}
                          {cell?.unitWarning && !cell.unitWarningCleared && (
                            <Text style={s.specDiffTag}>{cell.unitWarning}</Text>
                          )}
                          {cell?.matchState === 'quoted_spec_diff' && !cell.specDiffCleared && (
                            <Text style={s.specDiffTag}>
                              spec differs{cell.specDiffNote ? `: ${cell.specDiffNote}` : ''}
                            </Text>
                          )}
                        </View>
                        <Text style={[s.cellBox, { width: subQtyW, textAlign: 'center', borderRightWidth: 1, borderRightColor: C.border }]}>
                          {cell ? plain(cell.qty) : ''}
                        </Text>
                        <View style={[s.cellBox, { width: subPriceW, alignItems: 'flex-end' }]}>
                          {/* Quoted currency by default; whatever the reviewer
                              selected otherwise. See MoneyQuoted / ta-currency.ts. */}
                          {cell ? (
                            <MoneyQuoted
                              amount={cell.unitPrice}
                              currency={cell.currency}
                              fx={fx}
                              selection={currencyDisplay.lineItems}
                            />
                          ) : (
                            <Text> </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
                );
              })}

              {/* Total Price without VAT — ORIGINAL currency + SAR (primary) + USD,
                  matching the company form (e.g. "EUR 36,388 / SAR 155,013"). How
                  many of those lines print is the reviewer's currency choice.

                  This is the ONLY total the TA form carries. The form is a
                  technical/commercial comparison between offers, and VAT is a
                  pass-through that applies identically to whoever wins — including
                  it made two suppliers look different on a number that was never a
                  differentiator, and put a with-VAT figure next to a without-VAT one
                  where a reader could sign against the wrong row. `withVatAmount()`
                  is still exported and still correct; it simply is not printed here. */}
              <View style={s.rowFlex} wrap={false}>
                <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>Total Price without VAT</Text>
                {group.map((sup) => {
                  const q = qById.get(sup.quotationId)!;
                  return (
                    <View key={sup.quotationId} style={{ width: supW, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3, alignItems: 'flex-end' }}>
                      <MoneyDual amount={totalOf(q)} currency={q.currency} fx={fx} selection={currencyDisplay.totals} />
                    </View>
                  );
                })}
              </View>

              {/* Terms */}
              <TermRow label="Payment Terms" s={s} leftW={leftW} supW={supW} values={group.map((sup) => qById.get(sup.quotationId)!.paymentTerms ?? '')} />
              {/* Delivery Time — the supplier's ORIGINAL wording verbatim (e.g.
                  "4 to 5 weeks"), with the normalized day-count only as a faint
                  parenthetical hint, never as a replacement. When the items in one
                  offer have DIFFERENT lead times the cell lists them per item
                  ("Item #1 (2 weeks), Item #2 (6 weeks)") instead of printing one
                  of them over the whole offer. */}
              <TermRow
                label="Delivery Time"
                s={s}
                leftW={leftW}
                supW={supW}
                values={group.map((sup) => {
                  const q = qById.get(sup.quotationId)!;
                  const text = deliveries[sup.quotationId] ?? '';
                  if (!text || text === 'Not stated') return '';
                  // The day-count hint only makes sense for a single lead time; a
                  // per-item list already carries each item's own wording.
                  if (text !== (q.deliveryRaw?.trim() ?? '')) return text;
                  const hint = deliveryNormalizedHint(q.deliveryRaw, q.deliveryDays);
                  return hint ? `${text}  (${hint})` : text;
                })}
              />
              <TermRow label="Delivery Terms" s={s} leftW={leftW} supW={supW} values={group.map((sup) => qById.get(sup.quotationId)!.deliveryTerms ?? '')} />
              {/* Country of Origin — per-supplier toggle + AI-prefilled value (edit/
                  clear). DISPLAY-ONLY: the VAT rule reads the extracted origin, so
                  hiding/editing this never changes VAT. Row omitted if OFF for all. */}
              {showOrigin && (
                <FieldRow label="Country of Origin" s={s} leftW={leftW} supW={supW} group={group} byId={origins} />
              )}
              {/* Warranty — per-supplier toggle + AI-prefilled value ("Not stated"
                  when the quote states none; never invented). Row omitted if OFF for all. */}
              {showWarranty && (
                <FieldRow label="Warranty" s={s} leftW={leftW} supW={supW} group={group} byId={warranties} />
              )}

              {/* Technical Comments — AI-SUGGESTED verdict (indigo/italic) OR the
                  human's own plain comment once edited. Final Recommendation stays blank. */}
              <View style={s.rowFlex} wrap={false}>
                <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>Technical Comments</Text>
                {group.map((sup) => (
                  <CommentCell key={sup.quotationId} comment={comments[sup.quotationId]} width={supW} s={s} />
                ))}
              </View>

            </View>
          );
        })}

        {/* AI-SUGGESTED recommendation — clearly labelled, system-generated, NOT an
            approval. Kept SEPARATE from the human Technical Comments / Final
            Recommendation fields, which stay blank below. */}
        {ai ? (
          <View style={s.aiBox}>
            <Text style={s.aiLabel}>AI SUGGESTED — system-generated, NOT an approval</Text>
            <Text style={s.aiText}>{ai}</Text>
          </View>
        ) : null}

        {/* Final Recommendation — the HUMAN's selection when one was made (never
            AI-written); otherwise blank for the team to complete by hand. */}
        <View style={s.finalRow}>
          <Text style={{ fontFamily: 'Helvetica-Bold', color: C.ink }}>Final Recommendation:</Text>
          {selectedSupplier ? (
            <Text style={{ fontFamily: 'Helvetica-Bold', color: C.ink }}>
              {`${selectedSupplier}  `}
              <Text style={{ fontFamily: 'Helvetica-Oblique', color: C.muted, fontSize: 7 }}>
                (selected by reviewer)
              </Text>
            </Text>
          ) : null}
          <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: C.line, height: 12 }} />
        </View>

        {/* Signature blocks — user-configured count / names / order. */}
        {signRows.length > 0 && (
          <View style={s.signWrap}>
            {signRows.map((rowRoles, r) => (
              <View key={`sigrow-${r}`} style={s.signRow} wrap={false}>
                {rowRoles.map((role, i) => (
                  <View key={`${role}-${r}-${i}`} style={[s.signBox, { width: signW }]} wrap={false}>
                    <Text style={s.signTitle}>{role}</Text>
                    <View style={s.checkRow}>
                      <View style={s.box} />
                      <Text>Approved</Text>
                      <View style={[s.box, { marginLeft: 6 }]} />
                      <Text>Denied</Text>
                    </View>
                    <Text style={s.sigLine}>Signature:</Text>
                    <Text style={[s.sigLine, { marginTop: 4 }]}>Date:</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerLine}>Generated by AI Procurement Copilot — {generatedOn}</Text>
          <Text style={s.footerLine}>
            Auto-filled from extracted data. Blank fields are for manual completion.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// A Technical Comment cell: an AI-SUGGESTED verdict renders indigo/italic; once a
// human has edited it (aiSuggested=false) it renders as a plain human comment.
function CommentCell({
  comment,
  width,
  s,
}: {
  comment: TechnicalComment | undefined;
  width: number;
  s: ReturnType<typeof StyleSheet.create>;
}) {
  const text = comment?.text?.trim() ?? '';
  return (
    <View style={{ width, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3, minHeight: 22, justifyContent: 'center' }}>
      {text ? (
        <Text style={comment!.aiSuggested ? s.aiText : { color: C.ink }}>{text}</Text>
      ) : (
        <Text> </Text>
      )}
    </View>
  );
}

function TermRow({
  label,
  values,
  s,
  leftW,
  supW,
}: {
  label: string;
  values: string[];
  s: ReturnType<typeof StyleSheet.create>;
  leftW: number;
  supW: number;
}) {
  return (
    <View style={{ flexDirection: 'row' }} wrap={false}>
      <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>{label}</Text>
      {values.map((v, i) => (
        <Text key={i} style={[s.cellBox, { width: supW, borderRightWidth: 1, borderRightColor: C.line }]}>{v}</Text>
      ))}
    </View>
  );
}

// A per-supplier, individually toggleable field row (Warranty, Country of Origin).
// A supplier toggled OFF renders a BLANK cell (the row itself is only rendered when
// ≥1 supplier is ON). An AI-suggested value renders indigo/italic; a human edit
// (or a cleared value) renders as a plain, non-AI value.
function FieldRow({
  label,
  group,
  byId,
  s,
  leftW,
  supW,
}: {
  label: string;
  group: { quotationId: string }[];
  byId: Record<string, ApprovalFieldValue>;
  s: ReturnType<typeof StyleSheet.create>;
  leftW: number;
  supW: number;
}) {
  return (
    <View style={s.rowFlex} wrap={false}>
      <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>{label}</Text>
      {group.map((sup) => {
        const f = byId[sup.quotationId];
        const text = f?.enabled ? f.text?.trim() ?? '' : '';
        return (
          <View
            key={sup.quotationId}
            style={[s.cellBox, { width: supW, borderRightWidth: 1, borderRightColor: C.line }]}
          >
            {text ? (
              <Text style={f!.aiSuggested ? s.aiText : { color: C.ink }}>{text}</Text>
            ) : (
              <Text> </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Build the Technical Approval Form PDF as a Blob from the real analysis data. */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const roles = options?.signatureRoles?.length ? options.signatureRoles : DEFAULT_SIGNATURE_ROLES;
  const comments =
    options?.technicalComments ??
    suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition, analysis.quotations);
  // Warranty / Country of Origin: use the caller's per-supplier values (toggles +
  // human edits) when provided; otherwise default every supplier ON with the AI
  // pre-fill (so a direct download without opening the dialog still fills them).
  const warranties =
    options?.warranties ?? buildApprovalFields(analysis.quotations, suggestWarranties(analysis.quotations));
  const origins =
    options?.countriesOfOrigin ?? buildApprovalFields(analysis.quotations, suggestOrigins(analysis.quotations));
  // Live SAR/USD rate at generation time (cached fallback if the feed is down);
  // an injectable fx lets callers/tests supply a fixed rate.
  const fx = options?.fx !== undefined ? options.fx : await getFxRates();
  return pdf(
    <ApprovalDocument
      analysis={analysis}
      signatureRoles={roles}
      comments={comments}
      warranties={warranties}
      origins={origins}
      fx={fx}
      selectedSupplier={options?.selectedSupplier ?? null}
      itemReview={options?.itemReview}
      supplierNames={options?.supplierNames}
      prDescription={options?.prDescription}
      currencyDisplay={options?.currencyDisplay ?? TA_CURRENCY_DISPLAY_DEFAULT}
    />,
  ).toBlob();
}
