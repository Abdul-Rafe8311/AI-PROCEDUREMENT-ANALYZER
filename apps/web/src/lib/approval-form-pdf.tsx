'use client';

// Second, separate PDF: a pre-filled copy of the buyer's own "Technical Approval
// Form", generated on demand (dynamically imported on click). Every fillable
// field comes from the REAL extracted data — anything not present is left BLANK,
// never invented.
//
// Phase 4: the "PR Item Description" column shows the COMPANY'S own description
// and quantity (from the uploaded Purchase Requisition); each supplier's own
// REF#, qty and unit price sit beside it. With no PR, it falls back to the
// supplier-extracted descriptions and says so.
// Phase 3-5 updates honored: 5+ suppliers wrap into stacked column-groups; each
// supplier keeps its OWN currency; "Technical Comments" is always BLANK for the
// human, and the AI item-match result is shown as a SEPARATE, clearly-labeled
// signal row (never written into Technical Comments).
// Phase 5: the signature blocks are provided by the caller (user-configured),
// so their count, names and order vary per document — nothing is hardcoded.

import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { scoreSuppliers } from './analysis-engine';
import { buildComparisonModel, supplierGroups } from './pr-comparison';
import {
  type AnalysisResult,
  DEFAULT_SIGNATURE_ROLES,
  DEFAULT_WEIGHTS,
  type ExtractedQuotation,
  type PrMatchResult,
} from './workspace-types';

const C = {
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#334155',
  border: '#cbd5e1',
  head: '#e2e8f0',
  win: '#dcfce7',
  winInk: '#166534',
  aiBg: '#eef2ff',
  aiBorder: '#6366f1',
};

export interface ApprovalFormOptions {
  /** ordered, enabled signature-block role names (defaults to DEFAULT_SIGNATURE_ROLES) */
  signatureRoles?: string[];
}

const SUP_PER_GROUP = 4; // suppliers per stacked block (landscape A4 fits ~4)
const USABLE = 797; // landscape A4 usable width (pt)

const numFmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : Math.round(n).toLocaleString('en-US');
const plain = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US');

// Document-stated currency totals only (no app-side conversion), so each
// supplier's own currency (EUR/SAR/USD/…) is preserved.
function totalLines(q: ExtractedQuotation): string[] {
  const stated = (q.statedTotals ?? []).filter((t) => t.amount != null);
  if (stated.length) return stated.map((t) => `${t.currency} ${numFmt(t.amount)}`);
  if (q.totalCost != null) return [`${q.currency} ${numFmt(q.totalCost)}`];
  return [''];
}

function aiRecommendation(analysis: AnalysisResult): string {
  const scored = scoreSuppliers(analysis.quotations, analysis.risks, DEFAULT_WEIGHTS);
  const best = scored[0];
  if (!best) return '';
  const name = best.quotation.supplierName;
  const rec = analysis.recommendation;
  const bits: string[] = [];
  if (rec.lowestCost?.supplier === name && best.quotation.totalCost != null) {
    bits.push(`lowest total cost (${best.quotation.currency} ${numFmt(best.quotation.totalCost)})`);
  }
  if (rec.fastestDelivery?.supplier === name && best.quotation.deliveryDays != null) {
    bits.push(`faster delivery (${best.quotation.deliveryDays} days)`);
  }
  const reason =
    bits.length > 0
      ? bits.join(' and ')
      : analysis.quotations.length === 1
        ? `only supplier analyzed; procurement score ${Math.round(best.overall * 100)}/100`
        : `highest procurement score (${Math.round(best.overall * 100)}/100)`;
  return `${name} — ${reason}.`;
}

// Per-supplier AI item-match signal (only meaningful with a PR). Kept SEPARATE
// from Technical Comments — a hint, never a verdict.
function matchSignal(prMatch: PrMatchResult | null, quotationId: string): string {
  const sm = prMatch?.bySupplier.find((s) => s.quotationId === quotationId);
  if (!sm) return '';
  if (sm.allMatched) return 'Yes (all items)';
  const bits: string[] = [];
  if (sm.mismatchCount) bits.push(`${sm.mismatchCount} mismatch`);
  if (sm.missingPrIndexes.length) bits.push(`${sm.missingPrIndexes.length} not quoted`);
  return `No — ${bits.join(', ')}`;
}

function ApprovalDocument({
  analysis,
  signatureRoles,
}: {
  analysis: AnalysisResult;
  signatureRoles: string[];
}) {
  const qs = analysis.quotations;
  const qById = new Map(qs.map((q) => [q.id, q]));
  const model = buildComparisonModel(qs, analysis.purchaseRequisition, analysis.prMatch);
  const prMatch = analysis.prMatch ?? null;
  const ai = aiRecommendation(analysis);

  const pr = analysis.purchaseRequisition;
  const prNumber = pr?.requestNo ?? qs.find((q) => q.prNumber)?.prNumber ?? '';
  // With a PR, descriptions live in the table rows; without one, note the fallback.
  const firstProduct = qs.flatMap((q) => q.lineItems).find((li) => (li.category ?? 'product') === 'product');
  const prDesc = model.hasPr ? '' : firstProduct?.name ?? '';

  const indexed = model.suppliers.map((s, i) => ({ ...s, colIndex: i }));
  const groups = supplierGroups(indexed, SUP_PER_GROUP);
  const fs = 7;

  const s = StyleSheet.create({
    page: { paddingVertical: 20, paddingHorizontal: 22, fontSize: fs, color: C.body, fontFamily: 'Helvetica' },
    title: { textAlign: 'center', fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 6 },
    subNote: { textAlign: 'center', fontSize: fs - 0.5, color: C.muted, marginBottom: 8 },
    metaRow: { flexDirection: 'row', borderWidth: 1, borderColor: C.line, marginBottom: 8 },
    metaCell: { paddingVertical: 4, paddingHorizontal: 5, borderRightWidth: 1, borderRightColor: C.line },
    metaLabel: { fontFamily: 'Helvetica-Bold', color: C.ink },
    blockLabel: { fontSize: fs, fontFamily: 'Helvetica-Bold', color: C.muted, marginTop: 8, marginBottom: 3 },
    rowFlex: { flexDirection: 'row' },
    cellBox: { borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3, justifyContent: 'center' },
    headCell: { backgroundColor: C.head, fontFamily: 'Helvetica-Bold', color: C.ink },
    supHead: { backgroundColor: C.head, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3 },
    supName: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs + 0.5 },
    ref: { color: C.muted, fontSize: fs - 0.5 },
    labelRow: { fontFamily: 'Helvetica-Bold', color: C.ink },
    winCell: { backgroundColor: C.win, color: C.winInk, fontFamily: 'Helvetica-Bold' },
    aiRowLabel: { fontFamily: 'Helvetica-Bold', color: C.aiBorder },
    aiBox: { marginTop: 10, borderWidth: 1.2, borderColor: C.aiBorder, backgroundColor: C.aiBg, borderRadius: 4, padding: 7 },
    aiLabel: { fontSize: fs - 0.5, fontFamily: 'Helvetica-Bold', color: C.aiBorder, marginBottom: 2 },
    finalRow: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    signWrap: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    signBox: { borderWidth: 1, borderColor: C.line, borderRadius: 3, padding: 5, minHeight: 66 },
    signTitle: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs, marginBottom: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 3 },
    box: { width: 7, height: 7, borderWidth: 1, borderColor: C.line },
    sigLine: { marginTop: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 2, color: C.muted },
    footer: { position: 'absolute', bottom: 12, left: 22, right: 22, textAlign: 'center', fontSize: 6.5, color: C.faint },
  });

  // Signature blocks wrap ≤4 per row so 6+ roles never overflow the page.
  const perRow = Math.min(signatureRoles.length || 1, 4);
  const signW = (USABLE - (perRow - 1) * 6) / perRow;

  return (
    <Document title="Technical Approval Form" author="AI Procurement Copilot">
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <Text style={s.title}>TECHNICAL APPROVAL FORM</Text>
        {!model.hasPr && (
          <Text style={s.subNote}>
            No internal Purchase Requisition was matched — item descriptions are taken from the supplier quotations.
          </Text>
        )}

        {/* Meta row */}
        <View style={s.metaRow}>
          <Text style={[s.metaCell, { width: 130 }]}>
            <Text style={s.metaLabel}>TA Date: </Text>
            {'                '}
          </Text>
          <Text style={[s.metaCell, { width: 140 }]}>
            <Text style={s.metaLabel}>PR#: </Text>
            {prNumber || '            '}
          </Text>
          <Text style={[s.metaCell, { flex: 1, borderRightWidth: 0 }]}>
            <Text style={s.metaLabel}>PR Description: </Text>
            {prDesc}
          </Text>
        </View>

        {/* One stacked block per group of suppliers (wraps 5+). */}
        {groups.map((group, gi) => {
          const leftW = 16 + descWidth(group.length) + 26 + 30;
          const supW = Math.max(88, (USABLE - leftW) / group.length);
          const idxW = 16;
          const descW = descWidth(group.length);
          const qtyLW = 26;
          const uomW = 30;
          const subQtyW = Math.min(28, supW * 0.3);
          const subUnitW = supW - subQtyW;

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
                <Text style={[s.cellBox, s.headCell, { width: descW, borderTopWidth: 1, borderTopColor: C.line }]}>
                  {model.hasPr ? 'PR Item Description' : 'Item Description'}
                </Text>
                <Text style={[s.cellBox, s.headCell, { width: qtyLW, borderTopWidth: 1, borderTopColor: C.line }]}>Qty</Text>
                <Text style={[s.cellBox, s.headCell, { width: uomW, borderTopWidth: 1, borderTopColor: C.line }]}>UOM</Text>
                {group.map((sup) => {
                  const q = qById.get(sup.quotationId)!;
                  return (
                    <View key={sup.quotationId} style={[s.supHead, { width: supW }]}>
                      <Text style={s.supName}>{sup.supplier}</Text>
                      <Text style={s.ref}>{sup.reference ? `REF# ${sup.reference}` : 'REF# —'}</Text>
                      <View style={[s.rowFlex, { marginTop: 2 }]}>
                        <Text style={{ width: subQtyW, fontFamily: 'Helvetica-Bold' }}>Qty</Text>
                        <Text style={{ width: subUnitW, fontFamily: 'Helvetica-Bold' }}>Unit Price ({q.currency})</Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Item rows */}
              {model.rows.map((r) => (
                <View key={`${r.kind}-${r.index}-${r.label}`} style={s.rowFlex} wrap={false}>
                  <Text style={[s.cellBox, { width: idxW, borderLeftWidth: 1, borderLeftColor: C.border, textAlign: 'center' }]}>
                    {r.kind === 'charge' ? '' : r.index}
                  </Text>
                  <Text style={[s.cellBox, { width: descW }]}>
                    {r.label}
                    {r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}
                  </Text>
                  <Text style={[s.cellBox, { width: qtyLW, textAlign: 'center' }]}>{plain(r.qty)}</Text>
                  <Text style={[s.cellBox, { width: uomW, textAlign: 'center' }]}>{r.uom ?? ''}</Text>
                  {group.map((sup) => {
                    const cell = r.cells[sup.colIndex] ?? null;
                    const isLow = cell?.unitPriceUsd != null && r.lowestUsd != null && cell.unitPriceUsd === r.lowestUsd;
                    return (
                      <View key={sup.quotationId} style={[s.rowFlex, { width: supW, borderRightWidth: 1, borderRightColor: C.line }]}>
                        <Text style={[s.cellBox, { width: subQtyW, textAlign: 'center', borderRightWidth: 1, borderRightColor: C.border }]}>
                          {cell ? plain(cell.qty) : ''}
                        </Text>
                        <Text style={[s.cellBox, { width: subUnitW, textAlign: 'right' }, ...(isLow ? [s.winCell] : [])]}>
                          {cell ? numFmt(cell.unitPrice) : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}

              {/* Total Price (document currencies) */}
              <View style={s.rowFlex} wrap={false}>
                <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>Total Price without VAT</Text>
                {group.map((sup) => {
                  const q = qById.get(sup.quotationId)!;
                  return (
                    <View key={sup.quotationId} style={{ width: supW, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3 }}>
                      {totalLines(q).map((t, j) => (
                        <Text key={j} style={{ fontFamily: 'Helvetica-Bold', color: C.ink, textAlign: 'right' }}>{t}</Text>
                      ))}
                    </View>
                  );
                })}
              </View>

              {/* Terms */}
              <TermRow label="Payment Terms" s={s} leftW={leftW} supW={supW} values={group.map((sup) => qById.get(sup.quotationId)!.paymentTerms ?? '')} />
              <TermRow label="Delivery Time" s={s} leftW={leftW} supW={supW} values={group.map((sup) => qById.get(sup.quotationId)!.deliveryRaw ?? '')} />
              <TermRow label="Delivery Terms" s={s} leftW={leftW} supW={supW} values={group.map((sup) => qById.get(sup.quotationId)!.deliveryTerms ?? '')} />

              {/* AI item-match signal — SEPARATE from Technical Comments, only with a PR. */}
              {model.hasPr && (
                <View style={s.rowFlex} wrap={false}>
                  <Text style={[s.cellBox, s.aiRowLabel, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>
                    AI: items match PR (not a verdict)
                  </Text>
                  {group.map((sup) => (
                    <Text key={sup.quotationId} style={[s.cellBox, { width: supW, borderRightWidth: 1, borderRightColor: C.line, color: C.aiBorder }]}>
                      {matchSignal(prMatch, sup.quotationId)}
                    </Text>
                  ))}
                </View>
              )}

              {/* Technical Comments — always BLANK for the human. */}
              <TermRow label="Technical Comments" s={s} leftW={leftW} supW={supW} values={group.map(() => '')} />
            </View>
          );
        })}

        {/* AI suggestion — clearly NOT a human decision */}
        {ai ? (
          <View style={s.aiBox}>
            <Text style={s.aiLabel}>AI SUGGESTED RECOMMENDATION — system-generated, NOT an approval</Text>
            <Text style={{ color: C.body }}>{ai}</Text>
          </View>
        ) : null}

        {/* Final Recommendation — blank for the human */}
        <View style={s.finalRow}>
          <Text style={{ fontFamily: 'Helvetica-Bold', color: C.ink }}>Final Recommendation:</Text>
          <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: C.line, height: 12 }} />
        </View>
        <Text style={{ fontSize: fs - 0.5, color: C.muted, marginTop: 2 }}>
          (Technical Comments and Final Recommendation are completed and signed by the reviewing team.)
        </Text>

        {/* Signature blocks — user-configured count / names / order. */}
        {signatureRoles.length > 0 && (
          <View style={s.signWrap}>
            {signatureRoles.map((role, i) => (
              <View key={`${role}-${i}`} style={[s.signBox, { width: signW }]}>
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
        )}

        <Text style={s.footer} fixed>
          Auto-filled from extracted data by AI Procurement Copilot. Blank fields are for manual completion.
        </Text>
      </Page>
    </Document>
  );
}

// Description column width shrinks a little as a group holds more suppliers.
function descWidth(groupSize: number): number {
  return groupSize <= 2 ? 240 : groupSize === 3 ? 210 : 190;
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

/** Build the Technical Approval Form PDF as a Blob from the real analysis data. */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const roles = options?.signatureRoles?.length ? options.signatureRoles : DEFAULT_SIGNATURE_ROLES;
  return pdf(<ApprovalDocument analysis={analysis} signatureRoles={roles} />).toBlob();
}
