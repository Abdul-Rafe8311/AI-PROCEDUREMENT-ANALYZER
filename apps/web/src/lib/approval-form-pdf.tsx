'use client';

// Second, separate PDF: a pre-filled copy of the buyer's own "Technical Approval
// Form", generated on demand (dynamically imported on click). Every fillable
// field comes from the REAL extracted data — anything not present is left BLANK.
//
// Layout (matches the buyer's reference): the PR item's OWN description + qty are
// the leftmost reference columns; then EACH supplier has their own column-group
// showing THEIR own quoted description, qty and unit price side by side for that
// same PR item row. 5+ suppliers wrap into stacked blocks; each keeps its own
// currency; lowest unit price per row is highlighted.
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
import { suggestTechnicalComments } from './item-matching';
import { buildComparisonModel, supplierGroups } from './pr-comparison';
import {
  type AnalysisResult,
  DEFAULT_SIGNATURE_ROLES,
  DEFAULT_WEIGHTS,
  type ExtractedQuotation,
  type PrMatchResult,
  type TechnicalComment,
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
  /** per-supplier Technical Comments keyed by quotation id (AI-suggested unless edited) */
  technicalComments?: Record<string, TechnicalComment>;
}

const SUP_PER_GROUP = 3; // suppliers per stacked block — each is now wider (own description col)
const USABLE = 797; // landscape A4 usable width (pt)

const numFmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : Math.round(n).toLocaleString('en-US');
const plain = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US');

// Document-stated currency totals only (no app-side conversion) → each supplier's
// own currency (EUR/SAR/USD/QAR/…) is preserved.
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

// Per-supplier AI item-match signal (only meaningful with a PR).
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
  comments,
}: {
  analysis: AnalysisResult;
  signatureRoles: string[];
  comments: Record<string, TechnicalComment>;
}) {
  const qs = analysis.quotations;
  const qById = new Map(qs.map((q) => [q.id, q]));
  const model = buildComparisonModel(qs, analysis.purchaseRequisition, analysis.prMatch);
  const prMatch = analysis.prMatch ?? null;
  const ai = aiRecommendation(analysis);

  const pr = analysis.purchaseRequisition;
  const prNumber = pr?.requestNo ?? qs.find((q) => q.prNumber)?.prNumber ?? '';

  const indexed = model.suppliers.map((s, i) => ({ ...s, colIndex: i }));
  const groups = supplierGroups(indexed, SUP_PER_GROUP);
  const fs = 6.5;

  const s = StyleSheet.create({
    page: { paddingVertical: 20, paddingHorizontal: 20, fontSize: fs, color: C.body, fontFamily: 'Helvetica' },
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
    subLabel: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs - 0.5 },
    labelRow: { fontFamily: 'Helvetica-Bold', color: C.ink },
    winCell: { backgroundColor: C.win, color: C.winInk, fontFamily: 'Helvetica-Bold' },
    aiRowLabel: { fontFamily: 'Helvetica-Bold', color: C.aiBorder },
    aiTag: { fontSize: fs - 1.5, fontFamily: 'Helvetica-Bold', color: C.aiBorder, marginBottom: 1 },
    aiText: { color: C.aiBorder, fontFamily: 'Helvetica-Oblique' },
    aiBox: { marginTop: 10, borderWidth: 1.2, borderColor: C.aiBorder, backgroundColor: C.aiBg, borderRadius: 4, padding: 7 },
    aiLabel: { fontSize: fs - 0.5, fontFamily: 'Helvetica-Bold', color: C.aiBorder, marginBottom: 2 },
    finalRow: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    signWrap: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    signBox: { borderWidth: 1, borderColor: C.line, borderRadius: 3, padding: 5, minHeight: 66 },
    signTitle: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs, marginBottom: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 3 },
    box: { width: 7, height: 7, borderWidth: 1, borderColor: C.line },
    sigLine: { marginTop: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 2, color: C.muted },
    footer: { position: 'absolute', bottom: 12, left: 20, right: 20, textAlign: 'center', fontSize: 6.5, color: C.faint },
  });

  const perRow = Math.min(signatureRoles.length || 1, 4);
  const signW = (USABLE - (perRow - 1) * 6) / perRow;

  const idxW = 14;
  const prDescW = 118;
  const qtyLW = 22;
  const uomW = 24;
  const leftW = idxW + prDescW + qtyLW + uomW;

  return (
    <Document title="Technical Approval Form" author="AI Procurement Copilot">
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <Text style={s.title}>TECHNICAL APPROVAL FORM</Text>
        {!model.hasPr && (
          <Text style={s.subNote}>
            No internal Purchase Requisition was matched — the left column shows the supplier-quoted description.
          </Text>
        )}

        {/* Meta row */}
        <View style={s.metaRow}>
          <Text style={[s.metaCell, { width: 130 }]}>
            <Text style={s.metaLabel}>TA Date: </Text>
            {'                '}
          </Text>
          <Text style={[s.metaCell, { width: 150 }]}>
            <Text style={s.metaLabel}>PR#: </Text>
            {prNumber || '            '}
          </Text>
          <Text style={[s.metaCell, { flex: 1, borderRightWidth: 0 }]}>
            <Text style={s.metaLabel}>Reviewed by: </Text>
            {'                                        '}
          </Text>
        </View>

        {groups.map((group, gi) => {
          const n = group.length;
          const supW = Math.max(150, (USABLE - leftW) / n);
          const subQtyW = 24;
          const subDescW = Math.max(70, Math.round(supW * 0.5));
          const subPriceW = supW - subDescW - subQtyW;

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
                  const q = qById.get(sup.quotationId)!;
                  return (
                    <View key={sup.quotationId} style={[s.supHead, { width: supW }]}>
                      <Text style={s.supName}>{sup.supplier}</Text>
                      <Text style={s.ref}>{sup.reference ? `REF# ${sup.reference}` : 'REF# —'}</Text>
                      <View style={[s.rowFlex, { marginTop: 2 }]}>
                        <Text style={[s.subLabel, { width: subDescW }]}>Description</Text>
                        <Text style={[s.subLabel, { width: subQtyW, textAlign: 'center' }]}>Qty</Text>
                        <Text style={[s.subLabel, { width: subPriceW, textAlign: 'right' }]}>Unit Price ({q.currency})</Text>
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
                  <Text style={[s.cellBox, { width: prDescW }]}>
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
                        <Text style={[s.cellBox, { width: subDescW, borderRightWidth: 1, borderRightColor: C.border }]}>
                          {cell?.description ?? ''}
                        </Text>
                        <Text style={[s.cellBox, { width: subQtyW, textAlign: 'center', borderRightWidth: 1, borderRightColor: C.border }]}>
                          {cell ? plain(cell.qty) : ''}
                        </Text>
                        <Text style={[s.cellBox, { width: subPriceW, textAlign: 'right' }, ...(isLow ? [s.winCell] : [])]}>
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

              {/* Technical Comments — AI-suggested (visually distinct) OR human-entered. */}
              <View style={s.rowFlex} wrap={false}>
                <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>Technical Comments</Text>
                {group.map((sup) => (
                  <CommentCell key={sup.quotationId} comment={comments[sup.quotationId]} width={supW} s={s} />
                ))}
              </View>
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
          Technical Comments shown in indigo/italic with an &quot;AI SUGGESTED&quot; tag are unreviewed machine
          suggestions — the reviewing team confirms or overwrites them and signs below.
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
        comment!.aiSuggested ? (
          <>
            <Text style={s.aiTag}>AI SUGGESTED — REVIEW</Text>
            <Text style={s.aiText}>{text}</Text>
          </>
        ) : (
          <Text style={{ color: C.ink }}>{text}</Text>
        )
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

/** Build the Technical Approval Form PDF as a Blob from the real analysis data. */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const roles = options?.signatureRoles?.length ? options.signatureRoles : DEFAULT_SIGNATURE_ROLES;
  const comments =
    options?.technicalComments ?? suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition);
  return pdf(
    <ApprovalDocument analysis={analysis} signatureRoles={roles} comments={comments} />,
  ).toBlob();
}
