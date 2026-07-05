'use client';

// Second, separate PDF: a pre-filled copy of the buyer's own "Technical Approval
// Form", generated on demand (dynamically imported on click). Every fillable
// field comes from the REAL extracted quotation data — anything not present in
// the source is left BLANK for manual entry, never invented. Human-judgment
// fields (Technical Comments, Final Recommendation, signatures) are always blank;
// the app's own suggestion appears only in a clearly-labeled "AI Suggested
// Recommendation" box so it can't be mistaken for a human decision.

import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { scoreSuppliers } from './analysis-engine';
import {
  type AnalysisResult,
  DEFAULT_WEIGHTS,
  type ExtractedQuotation,
  type LineItemCategory,
} from './workspace-types';

const C = {
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#334155',
  border: '#cbd5e1',
  head: '#e2e8f0',
  aiBg: '#eef2ff',
  aiBorder: '#6366f1',
  white: '#ffffff',
};

const num = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : Math.round(n).toLocaleString('en-US');
const plain = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US');

const norm = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const CHARGE_RANK: Record<LineItemCategory, number> = {
  product: 0,
  freight: 1,
  shipping: 1,
  insurance: 2,
  handling: 2,
  other: 3,
};

interface Cell {
  qty: number | null;
  unitPrice: number | null;
}
interface Row {
  index: number;
  label: string;
  leftQty: number | null;
  cells: (Cell | null)[]; // one per supplier, null = not quoted
}

function buildRows(qs: ExtractedQuotation[]): Row[] {
  const meta = new Map<string, { label: string; cat: LineItemCategory; seq: number }>();
  let seq = 0;
  for (const q of qs) {
    for (const li of q.lineItems) {
      const k = norm(li.name);
      if (!k || meta.has(k)) continue;
      meta.set(k, { label: li.name, cat: li.category ?? 'product', seq: seq++ });
    }
  }
  const keys = [...meta.keys()].sort((a, b) => {
    const A = meta.get(a)!;
    const B = meta.get(b)!;
    return CHARGE_RANK[A.cat] - CHARGE_RANK[B.cat] || A.seq - B.seq;
  });
  return keys.map((k, i) => {
    const cells: (Cell | null)[] = qs.map((q) => {
      const li = q.lineItems.find((l) => norm(l.name) === k);
      return li ? { qty: li.quantity, unitPrice: li.unitPrice } : null;
    });
    const presentQtys = cells.filter((c): c is Cell => !!c).map((c) => c.qty).filter((v): v is number => v != null);
    const leftQty = presentQtys.length && presentQtys.every((v) => v === presentQtys[0]) ? presentQtys[0] : null;
    return { index: i + 1, label: meta.get(k)!.label, leftQty, cells };
  });
}

// Only document-stated currency totals (per the buyer's choice — no app-side
// conversion). Falls back to the single stated total when no breakdown exists.
function totalLines(q: ExtractedQuotation): string[] {
  const stated = (q.statedTotals ?? []).filter((t) => t.amount != null);
  if (stated.length) return stated.map((t) => `${t.currency} ${num(t.amount)}`);
  if (q.totalCost != null) return [`${q.currency} ${num(q.totalCost)}`];
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
    bits.push(`lowest total cost (${best.quotation.currency} ${num(best.quotation.totalCost)})`);
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

const SIGN_ROLES = [
  'Planning Engineer',
  'Planning Team Leader',
  'PM Section Head Response',
  'Mech. Manager Response',
  'VP Operations Response',
];

function ApprovalDocument({ analysis }: { analysis: AnalysisResult }) {
  const qs = analysis.quotations;
  const nSup = Math.max(qs.length, 1);
  const rows = buildRows(qs);
  const ai = aiRecommendation(analysis);

  // Derive a short PR description from the product line items (editable/blank ok).
  const firstProduct = qs.flatMap((q) => q.lineItems).find((li) => (li.category ?? 'product') === 'product');
  const prDesc = firstProduct ? firstProduct.name : '';

  // Fixed column widths (points) so header + body align. Landscape A4 usable ≈ 797.
  const USABLE = 797;
  const idxW = 16;
  const qtyLW = 24;
  const uomW = 28;
  const descW = nSup <= 4 ? 200 : Math.max(120, 220 - (nSup - 4) * 24);
  const leftW = idxW + descW + qtyLW + uomW;
  const supW = Math.max(70, (USABLE - leftW) / nSup);
  const subQtyW = Math.min(24, supW * 0.3);
  const subUnitW = supW - subQtyW;
  const fs = nSup > 4 ? 6 : 7; // shrink text when many suppliers

  const s = StyleSheet.create({
    page: { paddingVertical: 20, paddingHorizontal: 22, fontSize: fs, color: C.body, fontFamily: 'Helvetica' },
    title: { textAlign: 'center', fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 8 },
    metaRow: { flexDirection: 'row', borderWidth: 1, borderColor: C.line, marginBottom: 6 },
    metaCell: { paddingVertical: 4, paddingHorizontal: 5, borderRightWidth: 1, borderRightColor: C.line },
    metaLabel: { fontFamily: 'Helvetica-Bold', color: C.ink },
    cellBox: { borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3, justifyContent: 'center' },
    headCell: { backgroundColor: C.head, fontFamily: 'Helvetica-Bold', color: C.ink },
    supHead: { backgroundColor: C.head, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3 },
    supName: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs + 0.5 },
    ref: { color: C.muted, fontSize: fs - 0.5 },
    rowFlex: { flexDirection: 'row' },
    labelRow: { fontFamily: 'Helvetica-Bold', color: C.ink },
    aiBox: { marginTop: 10, borderWidth: 1.2, borderColor: C.aiBorder, backgroundColor: C.aiBg, borderRadius: 4, padding: 7 },
    aiLabel: { fontSize: fs - 0.5, fontFamily: 'Helvetica-Bold', color: C.aiBorder, marginBottom: 2 },
    finalRow: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    signWrap: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
    signBox: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 3, padding: 5, minHeight: 66 },
    signTitle: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: fs, marginBottom: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 3 },
    box: { width: 7, height: 7, borderWidth: 1, borderColor: C.line },
    sigLine: { marginTop: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 2, color: C.muted },
    footer: { position: 'absolute', bottom: 12, left: 22, right: 22, textAlign: 'center', fontSize: 6.5, color: C.faint },
  });

  // A per-supplier "row segment" (Qty | Unit) sharing the same widths everywhere.
  const supHeaderCells = qs.map((q, i) => (
    <View key={i} style={[s.supHead, { width: supW }]}>
      <Text style={s.supName}>
        Supplier {i + 1}: {q.supplierName}
      </Text>
      <Text style={s.ref}>{q.reference ? `REF# ${q.reference}` : 'REF# —'}</Text>
      <View style={[s.rowFlex, { marginTop: 2 }]}>
        <Text style={{ width: subQtyW, fontFamily: 'Helvetica-Bold' }}>Qty</Text>
        <Text style={{ width: subUnitW, fontFamily: 'Helvetica-Bold' }}>Unit Price ({q.currency})</Text>
      </View>
    </View>
  ));

  return (
    <Document title="Technical Approval Form" author="AI Procurement Copilot">
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <Text style={s.title}>TECHNICAL APPROVAL FORM</Text>

        {/* Meta row: TA Date (blank), PR# (blank), PR Description (derived) */}
        <View style={s.metaRow}>
          <Text style={[s.metaCell, { width: 130 }]}>
            <Text style={s.metaLabel}>TA Date: </Text>
            {'                '}
          </Text>
          <Text style={[s.metaCell, { width: 120 }]}>
            <Text style={s.metaLabel}>PR#: </Text>
            {'            '}
          </Text>
          <Text style={[s.metaCell, { flex: 1, borderRightWidth: 0 }]}>
            <Text style={s.metaLabel}>PR Description: </Text>
            {prDesc}
          </Text>
        </View>

        {/* Header band */}
        <View style={s.rowFlex}>
          <Text style={[s.cellBox, s.headCell, { width: idxW, borderLeftWidth: 1, borderLeftColor: C.line, borderTopWidth: 1, borderTopColor: C.line }]}>#</Text>
          <Text style={[s.cellBox, s.headCell, { width: descW, borderTopWidth: 1, borderTopColor: C.line }]}>PR Item Description</Text>
          <Text style={[s.cellBox, s.headCell, { width: qtyLW, borderTopWidth: 1, borderTopColor: C.line }]}>Qty</Text>
          <Text style={[s.cellBox, s.headCell, { width: uomW, borderTopWidth: 1, borderTopColor: C.line }]}>UOM</Text>
          {supHeaderCells}
        </View>

        {/* Line-item rows */}
        {rows.map((r) => (
          <View key={r.index} style={s.rowFlex} wrap={false}>
            <Text style={[s.cellBox, { width: idxW, borderLeftWidth: 1, borderLeftColor: C.border, textAlign: 'center' }]}>{r.index}</Text>
            <Text style={[s.cellBox, { width: descW }]}>{r.label}</Text>
            <Text style={[s.cellBox, { width: qtyLW, textAlign: 'center' }]}>{plain(r.leftQty)}</Text>
            <Text style={[s.cellBox, { width: uomW }]}> </Text>
            {r.cells.map((c, i) => (
              <View key={i} style={[s.rowFlex, { width: supW, borderRightWidth: 1, borderRightColor: C.line }]}>
                <Text style={[s.cellBox, { width: subQtyW, textAlign: 'center', borderRightWidth: 1, borderRightColor: C.border }]}>{c ? plain(c.qty) : ''}</Text>
                <Text style={[s.cellBox, { width: subUnitW, textAlign: 'right' }]}>{c ? num(c.unitPrice) : ''}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Totals (document currencies only) */}
        <View style={s.rowFlex} wrap={false}>
          <Text style={[s.cellBox, s.labelRow, { width: leftW, borderLeftWidth: 1, borderLeftColor: C.border }]}>Total Price without VAT</Text>
          {qs.map((q, i) => (
            <View key={i} style={[{ width: supW, borderRightWidth: 1, borderRightColor: C.line, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3, paddingHorizontal: 3 }]}>
              {totalLines(q).map((t, j) => (
                <Text key={j} style={{ fontFamily: 'Helvetica-Bold', color: C.ink, textAlign: 'right' }}>{t}</Text>
              ))}
            </View>
          ))}
        </View>

        {/* Terms rows */}
        <TermRow label="Payment Terms" values={qs.map((q) => q.paymentTerms ?? '')} s={s} leftW={leftW} supW={supW} />
        <TermRow label="Delivery Time" values={qs.map((q) => q.deliveryRaw ?? '')} s={s} leftW={leftW} supW={supW} />
        <TermRow label="Delivery Terms" values={qs.map((q) => q.deliveryTerms ?? '')} s={s} leftW={leftW} supW={supW} />
        <TermRow label="Technical Comments" values={qs.map(() => '')} s={s} leftW={leftW} supW={supW} />

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
          (To be completed and signed by the reviewing team.)
        </Text>

        {/* Five signature blocks */}
        <View style={s.signWrap}>
          {SIGN_ROLES.map((role) => (
            <View key={role} style={s.signBox}>
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

        <Text style={s.footer} fixed>
          Auto-filled from extracted quotation data by AI Procurement Copilot. Blank fields are for manual completion.
        </Text>
      </Page>
    </Document>
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
export async function generateApprovalFormPdf(analysis: AnalysisResult): Promise<Blob> {
  return pdf(<ApprovalDocument analysis={analysis} />).toBlob();
}
