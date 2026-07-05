'use client';

// Client-only, on-demand PDF report generator. Dynamically imported on button
// click so @react-pdf/renderer stays out of the main bundle and off the server.
// Reuses the SAME scoring/summary/risk engine functions the on-screen report
// uses, so the PDF mirrors exactly what the buyer sees — including "missing (0)"
// scores, benchmark markers, and per-rule risk explanations. Built only from the
// real analysis data — never invented values.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';
import {
  buildExecutiveSummary,
  RISK_RULE_CATALOG,
  scoreSuppliers,
  toUsd,
  warrantyMonths,
} from './analysis-engine';
import {
  type AnalysisResult,
  DEFAULT_WEIGHTS,
  type ExtractedQuotation,
  formatCurrency,
  formatDelivery,
  type LineItemCategory,
  type RiskFlag,
  type RiskSeverity,
  type ScoreWeights,
  type SupplierScore,
} from './workspace-types';

const C = {
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  panel: '#f8fafc',
  primary: '#4f46e5',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  white: '#ffffff',
};

const s = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9.5, color: C.body, fontFamily: 'Helvetica' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.ink },
  subtitle: { fontSize: 9.5, color: C.muted, marginTop: 4 },
  sampleTag: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#fef3c7', color: '#92400e', fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 3, paddingHorizontal: 7, borderRadius: 4 },

  section: { marginTop: 22 },
  sectionTitle: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  para: { fontSize: 9.5, lineHeight: 1.5, color: C.body },

  recCard: { marginTop: 10, borderWidth: 1, borderColor: '#c7d2fe', backgroundColor: '#eef2ff', borderRadius: 6, padding: 12 },
  recBest: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.primary },
  recRow: { flexDirection: 'row', marginTop: 6 },
  recLabel: { width: 120, color: C.muted, fontSize: 9 },
  recValue: { flex: 1, fontSize: 9, color: C.body },

  // Generic table
  thead: { flexDirection: 'row', backgroundColor: C.ink, color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  th: { paddingVertical: 5, paddingHorizontal: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, fontSize: 8.5 },
  rowAlt: { backgroundColor: C.panel },
  td: { paddingVertical: 5, paddingHorizontal: 4, color: C.body },
  // Best value in a comparison column — green background + bold.
  win: { backgroundColor: '#dcfce7', color: C.success, fontFamily: 'Helvetica-Bold' },
  chargeTag: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.warning },

  totalRow: { flexDirection: 'row', backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold', fontSize: 8.5, borderTopWidth: 1.5, borderTopColor: C.ink },

  note: { marginTop: 8, fontSize: 8, color: C.muted, lineHeight: 1.45 },
  warnNote: { marginTop: 10, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 5, padding: 8, fontSize: 8.5, color: '#92400e', lineHeight: 1.45 },

  riskItem: { marginTop: 8, borderWidth: 1, borderColor: C.border, borderRadius: 5, padding: 9 },
  riskHead: { flexDirection: 'row', alignItems: 'center' },
  sevTag: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.white, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3, marginRight: 6 },
  riskMsg: { flex: 1, fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.ink },
  riskWhy: { marginTop: 4, fontSize: 8.5, color: C.muted, lineHeight: 1.45 },

  ruleItem: { marginTop: 6, flexDirection: 'row' },
  ruleTitle: { width: 140, fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.ink },
  ruleDetail: { flex: 1, fontSize: 8.5, color: C.muted, lineHeight: 1.4 },

  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.faint, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
});

const SEV_COLOR: Record<RiskSeverity, string> = { high: C.danger, medium: C.warning, low: C.muted };
const SEV_ORDER: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };

// Best-value test — only marks a winner when the values actually differ.
function isBest(v: number | null, vals: (number | null)[], lowerIsBetter: boolean): boolean {
  const present = vals.filter((x): x is number => x != null);
  if (v == null || present.length < 2) return false;
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (min === max) return false;
  return v === (lowerIsBetter ? min : max);
}

// Highest ACTUAL flag severity for a supplier — consistent with the Risk
// Findings list (not a summed-weight "level"). 'None' when no flags.
type WorstSev = 'High' | 'Medium' | 'Low' | 'None';
const SEV_RANK: Record<WorstSev, number> = { None: 0, Low: 1, Medium: 2, High: 3 };
function worstFlagSeverity(supplier: string, risks: RiskFlag[]): WorstSev {
  const flags = risks.filter((r) => r.supplier === supplier);
  if (flags.some((f) => f.severity === 'high')) return 'High';
  if (flags.some((f) => f.severity === 'medium')) return 'Medium';
  if (flags.some((f) => f.severity === 'low')) return 'Low';
  return 'None';
}

// Item matching (same normalization as the on-screen Line-Item Matrix).
const norm = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const CHARGE_RANK: Record<LineItemCategory, number> = {
  product: 0, freight: 1, shipping: 1, insurance: 2, handling: 2, other: 3,
};

interface ItemRow {
  label: string;
  category: LineItemCategory;
  qty: number | null;
  units: (number | null)[]; // original unit price per supplier
  usd: (number | null)[]; // USD unit price per supplier (drives "lowest")
  currencies: string[];
}
function buildItemRows(qs: ExtractedQuotation[]): ItemRow[] {
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
  return keys.map((k) => {
    const lis = qs.map((q) => q.lineItems.find((l) => norm(l.name) === k) ?? null);
    return {
      label: meta.get(k)!.label,
      category: meta.get(k)!.cat,
      qty: lis.map((li) => li?.quantity).find((v) => v != null) ?? null,
      units: lis.map((li) => (li ? li.unitPrice : null)),
      usd: lis.map((li) => (li && li.unitPrice != null ? toUsd(li.unitPrice, li.currency) : null)),
      currencies: lis.map((li) => li?.currency ?? 'USD'),
    };
  });
}

const CRITERIA: { key: keyof ScoreWeights; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'payment', label: 'Payment' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'risk', label: 'Risk' },
];

function Footer({ dateStr }: { dateStr: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>Generated by AI Procurement Copilot — {dateStr}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function ReportDocument({ analysis }: { analysis: AnalysisResult }) {
  const { quotations, recommendation: rec, risks } = analysis;
  const scored = scoreSuppliers(quotations, risks, DEFAULT_WEIGHTS);
  const best = scored[0];
  const bestScorePct = best ? Math.round(best.overall * 100) : 0;
  const singleSupplier = quotations.length === 1;
  const execSummary = buildExecutiveSummary(scored, risks);
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Confidence — mirrors the on-screen logic (n/a for a single supplier).
  const confidence =
    scored.length < 2 ? null : Math.round(Math.min(0.98, 0.6 + (scored[0].overall - scored[1].overall) * 2.5) * 100);

  // Savings vs the highest quote (USD-normalized) — mirrors the UI.
  const costs = quotations.map((q) => q.totalCostUsd).filter((v): v is number => v != null);
  const maxCost = costs.length ? Math.max(...costs) : null;
  const bestCostUsd = best?.quotation.totalCostUsd ?? null;
  const savings =
    bestCostUsd != null && maxCost != null && maxCost > bestCostUsd
      ? { amount: maxCost - bestCostUsd, pct: Math.round(((maxCost - bestCostUsd) / maxCost) * 100) }
      : null;

  const rawPts = (sc: SupplierScore, key: keyof ScoreWeights) =>
    DEFAULT_WEIGHTS[key] * sc.metrics[key].score * 100;
  const pts = (sc: SupplierScore, key: keyof ScoreWeights) => Math.round(rawPts(sc, key));
  const hasExcluded = scored.some((sc) => CRITERIA.some((c) => sc.metrics[c.key].status === 'no-comparison'));
  const hasProp = scored.some((sc) => CRITERIA.some((c) => sc.metrics[c.key].status === 'proportional'));
  const propCriteria = new Set(
    CRITERIA.filter((c) => scored.some((sc) => sc.metrics[c.key].status === 'proportional')).map((c) => c.key),
  );

  const sortedRisks = [...risks].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  // Comparison table column flex weights.
  const col = { sup: 2.1, orig: 1.7, usd: 1.4, del: 1.25, pay: 2, war: 1.2, score: 0.85, risk: 1 };

  // Per-column values for best-value highlighting (mirrors the on-screen UI).
  const costUsdVals = quotations.map((q) => q.totalCostUsd);
  const delVals = quotations.map((q) => q.deliveryDays);
  const warrVals = quotations.map((q) => {
    const m = warrantyMonths(q.warranty);
    return m > 0 ? m : null;
  });
  const scoreVals = quotations.map((q) => {
    const sc = scored.find((x) => x.quotation.id === q.id);
    return sc ? Math.round(sc.overall * 100) : null;
  });
  const riskRankVals = quotations.map((q) => SEV_RANK[worstFlagSeverity(q.supplierName, risks)]);
  const itemRows = buildItemRows(quotations);
  const itemUsdTotals = quotations.map((q) => q.totalCostUsd);

  return (
    <Document title="Procurement Analysis Report" author="AI Procurement Copilot">
      {/* ── Page 1: header, recommendation, summary, comparison ── */}
      <Page size="A4" style={s.page}>
        <View>
          <Text style={s.title}>Procurement Analysis Report</Text>
          <Text style={s.subtitle}>
            {dateStr}  •  {quotations.length} supplier{quotations.length === 1 ? '' : 's'} compared  •  {risks.length} risk
            {risks.length === 1 ? '' : 's'} flagged
          </Text>
          {analysis.simulated && <Text style={s.sampleTag}>SAMPLE ANALYSIS — not real supplier data</Text>}
        </View>

        {/* Recommendation */}
        {best && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Recommendation</Text>
            <View style={s.recCard}>
              <Text style={s.recBest}>{best.quotation.supplierName}</Text>
              <View style={s.recRow}>
                <Text style={s.recLabel}>Procurement score</Text>
                <Text style={s.recValue}>
                  {bestScorePct}/100
                  {singleSupplier
                    ? ' — only supplier analyzed; graded against absolute benchmarks (no peer comparison).'
                    : ' — highest score on the system methodology.'}
                </Text>
              </View>
              {rec.lowestCost && (
                <View style={s.recRow}>
                  <Text style={s.recLabel}>Lowest cost</Text>
                  <Text style={s.recValue}>{rec.lowestCost.supplier} — {rec.lowestCost.detail}</Text>
                </View>
              )}
              {rec.fastestDelivery && (
                <View style={s.recRow}>
                  <Text style={s.recLabel}>Fastest delivery</Text>
                  <Text style={s.recValue}>{rec.fastestDelivery.supplier} — {rec.fastestDelivery.detail}</Text>
                </View>
              )}
              {savings && (
                <View style={s.recRow}>
                  <Text style={s.recLabel}>Potential savings</Text>
                  <Text style={s.recValue}>
                    {best.quotation.supplierName} saves {formatCurrency(savings.amount, 'USD')} ({savings.pct}%) vs the highest quote.
                  </Text>
                </View>
              )}
              <View style={s.recRow}>
                <Text style={s.recLabel}>Confidence</Text>
                <Text style={s.recValue}>
                  {confidence == null ? 'n/a — a single supplier has nothing to be compared against.' : `${confidence}%`}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Executive summary */}
        {execSummary ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Executive Summary</Text>
            <Text style={s.para}>{execSummary}</Text>
          </View>
        ) : null}

        {/* Comparison table */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Quotation Comparison</Text>
          <View style={s.thead}>
            <Text style={[s.th, { flex: col.sup }]}>Supplier</Text>
            <Text style={[s.th, { flex: col.orig, textAlign: 'right' }]}>Total (original)</Text>
            <Text style={[s.th, { flex: col.usd, textAlign: 'right' }]}>Total (USD)</Text>
            <Text style={[s.th, { flex: col.del, textAlign: 'right' }]}>Delivery</Text>
            <Text style={[s.th, { flex: col.pay }]}>Payment</Text>
            <Text style={[s.th, { flex: col.war }]}>Warranty</Text>
            <Text style={[s.th, { flex: col.score, textAlign: 'right' }]}>Score</Text>
            <Text style={[s.th, { flex: col.risk, textAlign: 'right' }]}>Risk</Text>
          </View>
          {quotations.map((q, i) => {
            const sc = scored.find((x) => x.quotation.id === q.id);
            const scorePct = sc ? Math.round(sc.overall * 100) : 0;
            const warrM = warrantyMonths(q.warranty);
            const winCost = isBest(q.totalCostUsd, costUsdVals, true);
            const winDel = isBest(q.deliveryDays, delVals, true);
            const winWarr = isBest(warrM > 0 ? warrM : null, warrVals, false);
            const winScore = isBest(scorePct, scoreVals, false);
            const worst = worstFlagSeverity(q.supplierName, risks);
            const winRisk = isBest(SEV_RANK[worst], riskRankVals, true);
            return (
              <View key={q.id} style={i % 2 ? [s.row, s.rowAlt] : s.row} wrap={false}>
                <Text style={[s.td, { flex: col.sup, fontFamily: 'Helvetica-Bold', color: C.ink }]}>
                  {q.supplierName}
                  {q.reference ? `\nRef: ${q.reference}` : ''}
                </Text>
                <Text style={[s.td, { flex: col.orig, textAlign: 'right' }, ...(winCost ? [s.win] : [])]}>
                  {q.totalCost == null ? '—' : formatCurrency(q.totalCost, q.currency)}
                </Text>
                <Text style={[s.td, { flex: col.usd, textAlign: 'right' }, ...(winCost ? [s.win] : [])]}>
                  {q.totalCostUsd == null ? '—' : formatCurrency(q.totalCostUsd, 'USD')}
                </Text>
                <Text style={[s.td, { flex: col.del, textAlign: 'right' }, ...(winDel ? [s.win] : [])]}>
                  {formatDelivery(q.deliveryDays)}
                  {q.deliveryTerms ? `\n${q.deliveryTerms}` : ''}
                </Text>
                <Text style={[s.td, { flex: col.pay, color: C.muted }]}>{q.paymentTerms ?? '—'}</Text>
                <Text style={[s.td, { flex: col.war, color: C.muted }, ...(winWarr ? [s.win] : [])]}>
                  {q.warranty ?? 'Not stated'}
                </Text>
                <Text style={[s.td, { flex: col.score, textAlign: 'right', fontFamily: 'Helvetica-Bold' }, ...(winScore ? [s.win] : [])]}>
                  {scorePct}
                </Text>
                <Text style={[s.td, { flex: col.risk, textAlign: 'right' }, ...(winRisk ? [s.win] : [])]}>{worst}</Text>
              </View>
            );
          })}
          <Text style={s.note}>
            Totals are the full payable amount including freight and all charge lines. &quot;Total (USD)&quot; is normalized
            for comparison; original currency is shown alongside. Green = best value in that column; Risk shows each
            supplier&apos;s highest actual flag severity (see Risk Findings).
          </Text>

          {/* Item-level comparison (unit price, original currency; lowest highlighted) */}
          {itemRows.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 5 }}>
                Item-Level Comparison
              </Text>
              <View style={s.thead}>
                <Text style={[s.th, { flex: 2.6 }]}>Item</Text>
                {quotations.map((q) => (
                  <Text key={q.id} style={[s.th, { flex: 1.4, textAlign: 'right' }]}>
                    {q.supplierName}
                  </Text>
                ))}
              </View>
              {itemRows.map((r, ri) => {
                const min = r.usd.filter((v): v is number => v != null);
                const minUsd = min.length ? Math.min(...min) : null;
                const showsWinner = min.length >= 2 && Math.min(...min) !== Math.max(...min);
                return (
                  <View key={ri} style={ri % 2 ? [s.row, s.rowAlt] : s.row} wrap={false}>
                    <Text style={[s.td, { flex: 2.6 }]}>
                      {r.label}
                      {r.category !== 'product' ? '  ' : ''}
                      {r.category !== 'product' ? <Text style={s.chargeTag}>[{r.category.toUpperCase()}]</Text> : ''}
                      {r.qty != null && r.category === 'product' ? `\nQty ${r.qty.toLocaleString('en-US')}` : ''}
                    </Text>
                    {r.units.map((u, ci) => {
                      const win = showsWinner && r.usd[ci] != null && r.usd[ci] === minUsd;
                      return (
                        <Text key={ci} style={[s.td, { flex: 1.4, textAlign: 'right' }, ...(win ? [s.win] : [])]}>
                          {u == null ? '—' : formatCurrency(u, r.currencies[ci])}
                        </Text>
                      );
                    })}
                  </View>
                );
              })}
              <View style={s.totalRow}>
                <Text style={[s.th, { flex: 2.6 }]}>Total quotation value</Text>
                {quotations.map((q, i) => (
                  <Text key={q.id} style={[s.th, { flex: 1.4, textAlign: 'right' }, ...(isBest(itemUsdTotals[i], itemUsdTotals, true) ? [{ color: C.success }] : [])]}>
                    {q.totalCost == null ? '—' : formatCurrency(q.totalCost, q.currency)}
                  </Text>
                ))}
              </View>
              <Text style={s.note}>
                Unit price in each supplier&apos;s original currency; green = lowest (compared in USD). &quot;—&quot; means the
                supplier did not quote that item.
              </Text>
            </View>
          )}
        </View>

        <Footer dateStr={dateStr} />
      </Page>

      {/* ── Page 2: scoring methodology ── */}
      <Page size="A4" style={s.page}>
        <View>
          <Text style={s.sectionTitle}>Procurement Scoring Breakdown</Text>
          <Text style={s.para}>
            Each supplier is scored 0–100. Price and Delivery are scored PROPORTIONALLY to the best value in the field:
            the best supplier earns the full weight and others earn weight x (best / theirs), so a quote 2x the cheapest
            scores about half — never a flat 0 for a finite gap. Payment and Warranty are normalized across suppliers
            (higher is better); Risk is scored from flagged severity. A value missing from the document scores 0 for that
            criterion (shown as &quot;missing (0)&quot;), never full marks. With a single supplier — or when all suppliers
            tie — a criterion is graded against an absolute benchmark (marked ~), and price (only meaningful versus peers)
            is marked n/a and excluded. Weights: Price {Math.round(DEFAULT_WEIGHTS.price * 100)}%, Delivery{' '}
            {Math.round(DEFAULT_WEIGHTS.delivery * 100)}%, Payment {Math.round(DEFAULT_WEIGHTS.payment * 100)}%, Warranty{' '}
            {Math.round(DEFAULT_WEIGHTS.warranty * 100)}%, Risk {Math.round(DEFAULT_WEIGHTS.risk * 100)}%.
          </Text>

          {singleSupplier && (
            <Text style={s.warnNote}>
              No comparison available — single supplier. Scores are graded against absolute benchmarks, not competing
              quotes. Price cannot be benchmarked without peers, so it is excluded from the total.
            </Text>
          )}

          <View style={{ marginTop: 12 }}>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 2 }]}>Criteria</Text>
              <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Weight</Text>
              {scored.map((sc) => (
                <Text key={sc.quotation.id} style={[s.th, { flex: 1.6, textAlign: 'right' }]}>
                  {sc.quotation.supplierName}
                </Text>
              ))}
            </View>
            {CRITERIA.map((c, ri) => (
              <View key={c.key} style={ri % 2 ? [s.row, s.rowAlt] : s.row} wrap={false}>
                <Text style={[s.td, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>
                  {c.label}
                  {propCriteria.has(c.key) ? <Text style={{ fontFamily: 'Helvetica', color: C.muted, fontSize: 7 }}>{'\n'}proportional to best</Text> : ''}
                </Text>
                <Text style={[s.td, { flex: 1, textAlign: 'right', color: C.muted }]}>
                  {Math.round(DEFAULT_WEIGHTS[c.key] * 100)}%
                </Text>
                {scored.map((sc) => {
                  const m = sc.metrics[c.key];
                  let label: string;
                  let color = C.body;
                  if (m.status === 'missing') {
                    label = 'missing (0)';
                    color = C.danger;
                  } else if (m.status === 'no-comparison') {
                    label = 'n/a';
                    color = C.muted;
                  } else if (m.status === 'proportional') {
                    label = rawPts(sc, c.key).toFixed(1);
                  } else {
                    label = `${pts(sc, c.key)}${m.status === 'benchmark' ? ' ~' : ''}`;
                  }
                  return (
                    <Text key={sc.quotation.id} style={[s.td, { flex: 1.6, textAlign: 'right', color }]}>
                      {label}
                    </Text>
                  );
                })}
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={[s.th, { flex: 3, color: C.ink }]}>Total Procurement Score</Text>
              {scored.map((sc, i) => (
                <Text key={sc.quotation.id} style={[s.th, { flex: 1.6, textAlign: 'right', color: i === 0 ? C.primary : C.ink }]}>
                  {Math.round(sc.overall * 100)}
                  {i === 0 && !singleSupplier ? ' *' : ''}
                </Text>
              ))}
            </View>
          </View>

          {hasProp && (
            <Text style={s.note}>
              Price &amp; Delivery use proportional scoring: the best supplier earns the full weight and others earn weight
              x (best / theirs). Example: a quote 2.25x the cheapest scores ~44% of the price weight (17.8 of 40), not 0.
            </Text>
          )}
          {hasExcluded && (
            <Text style={s.note}>
              ~ graded against an absolute benchmark (no peer comparison). &quot;n/a&quot; criteria are excluded from the
              total and the remaining weights are renormalized so the score still totals out of 100.  * recommended supplier.
            </Text>
          )}
        </View>
        <Footer dateStr={dateStr} />
      </Page>

      {/* ── Page 3: risks ── */}
      <Page size="A4" style={s.page}>
        <View>
          <Text style={s.sectionTitle}>Risk Findings</Text>
          {sortedRisks.length ? (
            sortedRisks.map((r, i) => (
              <View key={i} style={s.riskItem} wrap={false}>
                <View style={s.riskHead}>
                  <Text style={[s.sevTag, { backgroundColor: SEV_COLOR[r.severity] }]}>{r.severity.toUpperCase()}</Text>
                  <Text style={s.riskMsg}>{r.supplier} — {r.message}</Text>
                </View>
                <Text style={s.riskWhy}>{r.explanation}</Text>
              </View>
            ))
          ) : (
            <Text style={s.para}>No material risks were detected across these quotations.</Text>
          )}

          <View style={{ marginTop: 22 }}>
            <Text style={s.sectionTitle}>How Risks Are Detected</Text>
            <Text style={s.para}>Every quotation is checked against these plain rules; a match flags that supplier.</Text>
            {RISK_RULE_CATALOG.map((rule) => (
              <View key={rule.title} style={s.ruleItem} wrap={false}>
                <Text style={s.ruleTitle}>
                  {rule.title} ({rule.severity})
                </Text>
                <Text style={s.ruleDetail}>{rule.detail}</Text>
              </View>
            ))}
          </View>
        </View>
        <Footer dateStr={dateStr} />
      </Page>
    </Document>
  );
}

/** Build the report PDF as a Blob from the real analysis data. */
export async function generateReportPdf(analysis: AnalysisResult): Promise<Blob> {
  return pdf(<ReportDocument analysis={analysis} />).toBlob();
}
