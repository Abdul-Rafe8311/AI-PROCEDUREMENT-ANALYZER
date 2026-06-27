// Deterministic, realistic quotation analysis used by the MVP.
//
// Real extraction (PDF/DOCX/OCR) is the documented next step — it can be
// swapped in behind /api/extract without changing the UI, since this module
// produces the same AnalysisResult shape.

import { DEFAULT_WEIGHTS, formatCurrency } from './workspace-types';
import type {
  AnalysisResult,
  ExtractedQuotation,
  FieldKey,
  FieldProvenance,
  LineItem,
  Recommendation,
  RiskFlag,
  RiskSeverity,
  RiskType,
  ScoreWeights,
  SupplierScore,
} from './workspace-types';

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function prettySupplier(fileName: string, i: number): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(quotation|quote|supplier|rfq|offer)\b/gi, '')
    .trim();
  if (!base) return `Supplier ${String.fromCharCode(65 + i)}`;
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Shared catalog of construction/manufacturing materials. The same items appear
// for every supplier so the comparison matrix lines up; per-item price variation
// is added per supplier so different suppliers win different items.
const CATALOG: { name: string; quantity: number; weight: number }[] = [
  { name: 'Reinforced Steel Bars (12mm)', quantity: 500, weight: 0.34 },
  { name: 'Portland Cement (50kg)', quantity: 800, weight: 0.18 },
  { name: 'Structural Timber Beams', quantity: 300, weight: 0.2 },
  { name: 'Galvanized Roofing Sheets', quantity: 450, weight: 0.16 },
  { name: 'Fasteners & Fixings (set)', quantity: 1200, weight: 0.12 },
];

// ── Chat routing: comparison (analysis JSON) vs document (RAG over full text) ──
export type QuestionKind = 'comparison' | 'document';

const DOC_SIGNALS =
  /(section|clause|paragraph|page\s*\d|appendix|exhibit|annex|sub-?clause|article)\b|\bp\.?\s*\d+|\d+\.\d+|what does|does (it|the document|the quote|the contract) say|summari[sz]e|penalt|liquidated|scope of work|specification|terms (and|&) conditions|force majeure|indemnif|liabilit|governing law|sla\b/i;

const COMPARISON_SIGNALS =
  /cheapest|lowest|highest|compare|comparison|cost|price|delivery|fastest|payment terms|warranty|risk|score|saving|recommend|which supplier|best (overall|value|supplier)|most expensive/i;

/**
 * Classify a chat question. Comparison questions are answered from the analysis
 * JSON (existing path); document questions go to RAG over the full PDF text.
 * When ambiguous and the document is indexed, prefer document search.
 */
export function classifyQuestion(text: string, deepSearchReady: boolean): QuestionKind {
  const doc = DOC_SIGNALS.test(text);
  const cmp = COMPARISON_SIGNALS.test(text);
  if (doc && !cmp) return 'document';
  if (cmp && !doc) return 'comparison';
  if (doc && cmp) return deepSearchReady ? 'document' : 'comparison';
  // No strong signal: prefer deep search only when it's available.
  return deepSearchReady ? 'document' : 'comparison';
}

// Map a free-text keyword to a catalog item name (for chat queries).
const ITEM_KEYWORDS: { re: RegExp; name: string }[] = [
  { re: /steel|rebar|bar/i, name: 'Reinforced Steel Bars (12mm)' },
  { re: /cement|concrete/i, name: 'Portland Cement (50kg)' },
  { re: /timber|wood|beam|lumber/i, name: 'Structural Timber Beams' },
  { re: /roof|sheet/i, name: 'Galvanized Roofing Sheets' },
  { re: /fasten|fixing|bolt|screw|nut/i, name: 'Fasteners & Fixings (set)' },
];

export function matchCatalogItem(text: string): string | null {
  return ITEM_KEYWORDS.find((k) => k.re.test(text))?.name ?? null;
}

// Itemized breakdown that sums (in USD) to the supplier's total cost.
// `drop` removes the last N catalog items to simulate an incomplete quotation.
function buildLineItems(
  q: Omit<ExtractedQuotation, 'fields' | 'lineItems'>,
  drop = 0,
): LineItem[] {
  const totalUsd = q.totalCostUsd ?? 0;
  const fx = STATIC_FX[q.currency?.toUpperCase()] ?? 1;
  const kept = drop > 0 ? CATALOG.slice(0, CATALOG.length - drop) : CATALOG;
  const weights = kept.map((item) => {
    const jitter = ((hash(q.id + item.name) % 31) - 15) / 100; // ±15%
    return Math.max(0.02, item.weight * (1 + jitter));
  });
  const wsum = weights.reduce((a, b) => a + b, 0);

  return kept.map((item, i) => {
    const lineUsd = (totalUsd * weights[i]) / wsum;
    const totalPrice = Math.round(lineUsd / fx);
    const unitPrice = item.quantity
      ? Math.round((totalPrice / item.quantity) * 100) / 100
      : null;
    return { name: item.name, quantity: item.quantity, unitPrice, totalPrice, currency: q.currency };
  });
}

// Simulated source snippet + confidence per field (real OCR/extraction is the
// documented next step). A null value yields confidence 0 → rendered "Not found".
function buildFields(
  q: Omit<ExtractedQuotation, 'fields' | 'lineItems'>,
  h: number,
): Record<FieldKey, FieldProvenance> {
  const conf = (base: number, shift: number) =>
    Math.min(0.99, Math.round((base + ((h >> shift) % 12) / 100) * 100) / 100);

  return {
    supplierName: {
      snippet: `${q.supplierName} — quotation letterhead`,
      page: 1,
      confidence: conf(0.9, 2),
    },
    totalCost:
      q.totalCost == null
        ? { snippet: null, confidence: 0 }
        : {
            snippet: `Grand Total: ${q.totalCost.toLocaleString('en-US')} ${q.currency} (≈ ${money(q.totalCostUsd ?? 0)} USD)`,
            page: 2,
            confidence: conf(0.85, 5),
          },
    deliveryDays:
      q.deliveryDays == null
        ? { snippet: null, confidence: 0 }
        : {
            snippet: `Lead time: "${q.deliveryRaw}" → normalized to ${q.deliveryDays} days`,
            page: 1,
            confidence: conf(0.8, 8),
          },
    paymentTerms:
      q.paymentTerms == null
        ? { snippet: null, confidence: 0 }
        : {
            snippet: `Payment terms: ${q.paymentTerms}`,
            page: 2,
            confidence: conf(0.82, 11),
          },
    warranty:
      q.warranty == null
        ? { snippet: null, confidence: 0 } // genuinely not found in the document
        : {
            snippet: `Warranty: ${q.warranty} on parts & labour`,
            page: 3,
            confidence: conf(0.75, 14),
          },
  };
}

// Distinct supplier archetypes with REAL trade-offs so the demo always shows a
// clear lowest-cost / fastest / best-overall winner (and best != cheapest),
// plus at least one supplier with a problem so Risk Detection is never empty.
const ARCHETYPES: {
  amount: number;
  currency: string;
  deliveryRaw: string;
  terms: string;
  warranty: string | null;
  /** days from "today" the quote stays valid; negative = already expired */
  validDays: number;
  /** drop this many line items to simulate an incomplete quotation */
  dropItems: number;
}[] = [
  // Cheapest, but slowest AND no warranty (problem). Priced in USD.
  { amount: 8900, currency: 'USD', deliveryRaw: 'Approx. 4 weeks', terms: 'Net 60', warranty: null, validDays: 21, dropItems: 0 },
  // Fastest, most expensive, risky payment terms, AND expired validity. EUR.
  { amount: 13400, currency: 'EUR', deliveryRaw: '1 week', terms: '100% advance payment', warranty: '12 months', validDays: -5, dropItems: 0 },
  // Mid-priced (GBP), best warranty → typically best overall.
  { amount: 8300, currency: 'GBP', deliveryRaw: '10 working days', terms: 'Net 30', warranty: '36 months', validDays: 30, dropItems: 0 },
  // All-rounder but with an INCOMPLETE quotation (missing line items). USD.
  { amount: 11200, currency: 'USD', deliveryRaw: '11 days', terms: 'Net 45', warranty: '24 months', validDays: 14, dropItems: 2 },
];

// ── Normalization ──────────────────────────────────────────────
// TODO: replace STATIC_FX with a live FX source (e.g. an exchange-rate API).
const STATIC_FX: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  SAR: 0.2666,
  AED: 0.2723,
  CAD: 0.73,
  AUD: 0.66,
  QAR: 0.2747,
  KWD: 3.25,
  INR: 0.012,
  JPY: 0.0064,
};

/** USD-per-unit FX rate for a currency (1 when unknown). */
export function getUsdRate(currency: string): number {
  return STATIC_FX[currency?.toUpperCase()] ?? 1;
}

/** Convert an amount in `currency` to a normalized USD value. */
export function toUsd(amount: number | null, currency: string): number | null {
  if (amount == null) return null;
  return Math.round(amount * getUsdRate(currency));
}

/** Normalize free-text delivery ("2 weeks", "ASAP", a date) to integer days. */
export function normalizeDelivery(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/asap|immediate|same.?day|next.?day|in stock|ready now/.test(s)) return 1;

  const unit = s.match(/(\d+(?:\.\d+)?)\s*(day|week|month|year)/);
  if (unit) {
    const n = parseFloat(unit[1]);
    const mult =
      unit[2] === 'week' ? 7 : unit[2] === 'month' ? 30 : unit[2] === 'year' ? 365 : 1;
    return Math.round(n * mult);
  }

  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    const days = Math.ceil((asDate - Date.now()) / 86_400_000);
    if (days >= 0 && days < 3650) return days;
  }

  const bare = s.match(/(\d+(?:\.\d+)?)/);
  return bare ? Math.round(parseFloat(bare[1])) : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Heuristic for vague/risky payment terms (full upfront, COD, TBD, negotiable…).
function isRiskyPaymentTerms(terms: string): boolean {
  return /(advance|prepay|prepaid|100\s*%|upfront|cash\s*on|on\s*delivery|\bcod\b|\btbd\b|to be (confirmed|advised)|negotiable)/i.test(
    terms,
  );
}

export function buildAnalysis(fileNames: string[]): AnalysisResult {
  const names = fileNames.length
    ? fileNames
    : [
        'atlas-industrial-supply.pdf',
        'rapidship-trading.pdf',
        'meridian-materials.pdf',
        'keystone-procurement.pdf',
      ];

  const quotations: ExtractedQuotation[] = names.map((fileName, i) => {
    const profile = ARCHETYPES[i % ARCHETYPES.length];
    const h = hash(fileName + i);
    const jitter = (h % 600) - 300; // ±300 (original currency) so repeats differ
    const totalCost = profile.amount + jitter;
    const validUntil = new Date(Date.now() + profile.validDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const base = {
      id: `q_${i}`,
      fileName,
      supplierName: prettySupplier(fileName, i),
      totalCost,
      currency: profile.currency,
      totalCostUsd: toUsd(totalCost, profile.currency),
      deliveryRaw: profile.deliveryRaw,
      deliveryDays: normalizeDelivery(profile.deliveryRaw),
      paymentTerms: profile.terms,
      warranty: profile.warranty,
      validUntil,
      currencyConfidence: 1,
      usdRate: getUsdRate(profile.currency),
    };
    return {
      ...base,
      lineItems: buildLineItems(base, profile.dropItems),
      fields: buildFields(base, h),
    };
  });

  return assembleAnalysis(quotations, true);
}

/** Assemble a full AnalysisResult (risks + recommendation) from quotations. */
export function assembleAnalysis(
  quotations: ExtractedQuotation[],
  simulated: boolean,
): AnalysisResult {
  const risks = detectRisks(quotations);
  return {
    quotations,
    recommendation: buildRecommendation(quotations, risks),
    risks,
    simulated,
  };
}

export function buildRecommendation(
  qs: ExtractedQuotation[],
  risks: RiskFlag[],
): Recommendation {
  const withCostUsd = qs.filter((q) => q.totalCostUsd != null);
  const withDelivery = qs.filter((q) => q.deliveryDays != null);
  const rec: Recommendation = {};

  if (withCostUsd.length) {
    const cheapest = withCostUsd.reduce((a, b) =>
      a.totalCostUsd! <= b.totalCostUsd! ? a : b,
    );
    rec.lowestCost = {
      supplier: cheapest.supplierName,
      detail: `Lowest normalized cost at ${money(cheapest.totalCostUsd!)} (USD).`,
    };
  }

  if (withDelivery.length) {
    const fastest = withDelivery.reduce((a, b) =>
      a.deliveryDays! <= b.deliveryDays! ? a : b,
    );
    rec.fastestDelivery = {
      supplier: fastest.supplierName,
      detail: `Fastest delivery in ${fastest.deliveryDays} days.`,
    };
  }

  // Best overall = top of the deterministic weighted ranking (default weights).
  const scored = scoreSuppliers(qs, risks, DEFAULT_WEIGHTS);
  if (scored.length) {
    rec.bestOverall = {
      supplier: scored[0].quotation.supplierName,
      detail: 'Best balance of cost, delivery, warranty, and risk.',
    };
  }

  return rec;
}

// ── Deterministic weighted scoring (pure, no LLM) ──────────────
// Severity weights for the per-supplier risk score.
const RISK_SEVERITY: Record<RiskType, number> = {
  missing_delivery: 3,
  risky_payment_terms: 3,
  expired_validity: 3,
  incomplete_quotation: 3,
  unusually_low_price: 2,
  missing_warranty: 2,
  long_lead_time: 1,
  unusual_pricing: 1,
};

const SEVERITY_LABEL: Record<RiskType, RiskSeverity> = {
  missing_delivery: 'high',
  risky_payment_terms: 'high',
  expired_validity: 'high',
  incomplete_quotation: 'high',
  unusually_low_price: 'medium',
  missing_warranty: 'medium',
  long_lead_time: 'low',
  unusual_pricing: 'low',
};

/**
 * Days of supplier credit from payment terms — higher is better for the buyer.
 * "Net 45" -> 45; advance/prepaid/COD -> 0 (worst); unknown -> 15 (neutral-ish).
 */
export function paymentDays(terms: string | null): number {
  if (!terms) return 15;
  if (/advance|prepay|prepaid|100\s*%|upfront|cash\s*on|on\s*delivery|\bcod\b/i.test(terms)) {
    return 0;
  }
  const m = terms.match(/net\s*(\d+)/i) ?? terms.match(/(\d+)\s*days?/i);
  return m ? parseInt(m[1], 10) : 15;
}

/** Parse warranty months from a free-text string ("36 months", "2 years"). */
export function warrantyMonths(warranty: string | null): number {
  if (!warranty) return 0;
  const m = warranty.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return /year/i.test(warranty) ? n * 12 : n;
}

/** Summed severity of a supplier's risk flags. */
export function riskScoreFor(supplierName: string, risks: RiskFlag[]): number {
  return risks
    .filter((r) => r.supplier === supplierName)
    .reduce((sum, r) => sum + (RISK_SEVERITY[r.type] ?? 1), 0);
}

// Normalize to 0..1. If all values are equal, everyone gets 1 (no divide-by-zero).
function normalize(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 1;
  const t = (value - min) / (max - min);
  return higherIsBetter ? t : 1 - t;
}

/**
 * Pure deterministic ranking. Each metric is normalized to 0..1 (higher is
 * better), combined with the given weights (renormalized to sum to 1), and the
 * result is sorted best-first. Does NOT call any LLM.
 */
export function scoreSuppliers(
  quotations: ExtractedQuotation[],
  risks: RiskFlag[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): SupplierScore[] {
  if (!quotations.length) return [];

  const prices = quotations.map((q) => q.totalCostUsd ?? 0); // normalized USD
  const deliveries = quotations.map((q) => q.deliveryDays ?? 0);
  const payments = quotations.map((q) => paymentDays(q.paymentTerms));
  const warranties = quotations.map((q) => warrantyMonths(q.warranty));
  const riskScores = quotations.map((q) => riskScoreFor(q.supplierName, risks));

  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minD = Math.min(...deliveries), maxD = Math.max(...deliveries);
  const minPay = Math.min(...payments), maxPay = Math.max(...payments);
  const minW = Math.min(...warranties), maxW = Math.max(...warranties);
  const maxRisk = Math.max(...riskScores);
  const allRiskEqual = riskScores.every((r) => r === riskScores[0]);

  // Renormalize weights so they always sum to 1 (guard the all-zero case).
  const sum =
    weights.price + weights.delivery + weights.payment + weights.warranty + weights.risk;
  const w =
    sum > 0
      ? {
          price: weights.price / sum,
          delivery: weights.delivery / sum,
          payment: weights.payment / sum,
          warranty: weights.warranty / sum,
          risk: weights.risk / sum,
        }
      : { price: 0.2, delivery: 0.2, payment: 0.2, warranty: 0.2, risk: 0.2 };

  return quotations
    .map<SupplierScore>((q, i) => {
      const price = normalize(prices[i], minP, maxP, false); // lower is better
      const delivery = normalize(deliveries[i], minD, maxD, false); // lower is better
      const payment = normalize(payments[i], minPay, maxPay, true); // more credit is better
      const warranty = normalize(warranties[i], minW, maxW, true); // higher is better
      const risk = allRiskEqual ? 1 : 1 - riskScores[i] / maxRisk; // fewer/less severe is better
      const overall =
        w.price * price +
        w.delivery * delivery +
        w.payment * payment +
        w.warranty * warranty +
        w.risk * risk;
      return { quotation: q, price, delivery, payment, warranty, risk, overall };
    })
    .sort((a, b) => b.overall - a.overall);
}

export type RiskLevel = 'Low' | 'Medium' | 'High';

/** Coarse risk level from a supplier's summed flag severity. */
export function riskLevelFor(supplierName: string, risks: RiskFlag[]): RiskLevel {
  const s = riskScoreFor(supplierName, risks);
  if (s >= 4) return 'High';
  if (s >= 2) return 'Medium';
  return 'Low';
}

/** Procurement score 0-100 for a supplier under the given weights. */
export function procurementScore(
  supplierName: string,
  scored: SupplierScore[],
): number {
  const s = scored.find((x) => x.quotation.supplierName === supplierName);
  return s ? Math.round(s.overall * 100) : 0;
}

/**
 * Plain-language executive summary built purely from the data (no LLM).
 * Names the recommended supplier, savings vs the highest quote, payment/
 * delivery posture, and the leading risk.
 */
export function buildExecutiveSummary(
  scored: SupplierScore[],
  risks: RiskFlag[],
): string {
  if (!scored.length) return '';
  const best = scored[0].quotation;
  const costs = scored
    .map((s) => s.quotation.totalCostUsd)
    .filter((v): v is number => v != null);
  if (!costs.length) return `${best.supplierName} is the recommended supplier.`;

  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  const maxCost = Math.max(...costs);
  const bestCost = best.totalCostUsd ?? avg;
  const vsAvgPct = avg > 0 ? Math.round(((avg - bestCost) / avg) * 1000) / 10 : 0;
  const savings = maxCost - bestCost;
  const savingsPct = maxCost > 0 ? Math.round((savings / maxCost) * 1000) / 10 : 0;

  const fastest = [...scored]
    .map((s) => s.quotation)
    .filter((q) => q.deliveryDays != null)
    .sort((a, b) => a.deliveryDays! - b.deliveryDays!)[0];

  const parts: string[] = [];
  parts.push(
    vsAvgPct > 0
      ? `${best.supplierName} is ${vsAvgPct}% cheaper than the average quotation`
      : `${best.supplierName} is the best-balanced quotation`,
  );
  if (best.paymentTerms) parts.push(`offers ${best.paymentTerms} payment terms`);
  let summary = parts.join(' and ') + '.';

  if (best.deliveryDays != null) {
    if (fastest && fastest.supplierName !== best.supplierName) {
      const gap = best.deliveryDays - (fastest.deliveryDays ?? 0);
      summary += ` Delivery is ${gap} day${gap === 1 ? '' : 's'} slower than ${fastest.supplierName} but remains within typical project timelines.`;
    } else {
      summary += ` It also provides the fastest delivery at ${best.deliveryDays} days.`;
    }
  }

  if (savings > 0) {
    summary += ` Choosing it over the highest quotation saves ${money(savings)} (${savingsPct}%).`;
  }
  const bestRisks = risks.filter((r) => r.supplier === best.supplierName);
  summary += bestRisks.length
    ? ` Note: ${bestRisks.length} risk flag${bestRisks.length === 1 ? '' : 's'} to review before award.`
    : ` No material risks were detected for this supplier.`;
  return summary;
}

export function detectRisks(qs: ExtractedQuotation[]): RiskFlag[] {
  const risks: RiskFlag[] = [];
  const costs = qs.filter((q) => q.totalCostUsd != null).map((q) => q.totalCostUsd!);
  const med = costs.length ? median(costs) : 0;
  const catalogSize = Math.max(...qs.map((q) => q.lineItems.length), 0);
  const today = new Date().toISOString().slice(0, 10);

  const add = (supplier: string, type: RiskType, message: string) =>
    risks.push({ supplier, type, severity: SEVERITY_LABEL[type], message });

  for (const q of qs) {
    // Delivery
    if (q.deliveryDays == null) {
      add(q.supplierName, 'missing_delivery', `${q.supplierName}: no delivery date provided.`);
    } else if (q.deliveryDays >= 14) {
      add(q.supplierName, 'long_lead_time', `${q.supplierName}: ${q.deliveryDays}-day lead time may delay milestones.`);
    }

    // Warranty
    if (!q.warranty) {
      add(q.supplierName, 'missing_warranty', `${q.supplierName}: no warranty information found.`);
    }

    // Payment terms
    if (q.paymentTerms && isRiskyPaymentTerms(q.paymentTerms)) {
      add(q.supplierName, 'risky_payment_terms', `${q.supplierName}: payment terms "${q.paymentTerms}" require payment upfront / reduce buyer protection.`);
    }

    // Pricing outliers (both directions)
    if (q.totalCostUsd != null && med > 0) {
      if (q.totalCostUsd > med * 1.25) {
        add(q.supplierName, 'unusual_pricing', `${q.supplierName}: priced ${Math.round(((q.totalCostUsd - med) / med) * 100)}% above the median quote.`);
      } else if (q.totalCostUsd < med * 0.7) {
        add(q.supplierName, 'unusually_low_price', `${q.supplierName}: priced ${Math.round(((med - q.totalCostUsd) / med) * 100)}% below the median — verify scope/quality before award.`);
      }
    }

    // Expired quotation validity
    if (q.validUntil && q.validUntil < today) {
      add(q.supplierName, 'expired_validity', `${q.supplierName}: quotation validity expired on ${q.validUntil}.`);
    }

    // Incomplete quotation (missing line items, or any line missing a price)
    const missingPrice = q.lineItems.some((li) => li.unitPrice == null || li.totalPrice == null);
    if (q.lineItems.length < catalogSize || missingPrice) {
      const missing = catalogSize - q.lineItems.length;
      add(q.supplierName, 'incomplete_quotation', `${q.supplierName}: incomplete quotation${missing > 0 ? ` — ${missing} line item${missing === 1 ? '' : 's'} not provided` : ' — some line items missing prices'}.`);
    }
  }

  return risks;
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

// Rule-based chat fallback when OPENAI_API_KEY is not configured.
// Computes genuine answers from the analysis data.
export function answerFromData(question: string, analysis: AnalysisResult): string {
  const q = question.toLowerCase();
  const { quotations: qs, recommendation: rec } = analysis;
  if (!qs.length) return 'Upload and analyze some quotations first, then ask me anything about them.';

  // 1) Per-item / material price queries ("lowest steel price", "compare cement")
  const item = matchCatalogItem(q);
  if (item) {
    const rows = qs
      .map((s) => {
        const li = s.lineItems.find((l) => l.name === item);
        return { supplier: s.supplierName, usd: li?.unitPrice == null ? null : toUsd(li.unitPrice, li.currency) };
      })
      .filter((r): r is { supplier: string; usd: number } => r.usd != null)
      .sort((a, b) => a.usd - b.usd);
    if (!rows.length) return `None of the quotations list a unit price for ${item}.`;
    const lines = rows.map((r, i) => `• ${r.supplier}: ${money(r.usd)}${i === 0 ? '  ← lowest' : ''}`);
    return `${item} unit price (USD-normalized):\n${lines.join('\n')}\n\nCheapest: ${rows[0].supplier} at ${money(rows[0].usd)}.`;
  }

  // 1b) "list the items / what goods are in this" — list extracted line items,
  // or be honest about why there are none.
  if (/(list|show|what).*(item|good|product|material)|^items?\b|^goods\b|line items?|what('| i)?s in (this|the)/.test(q)) {
    const withItems = qs.filter((s) => s.lineItems.length > 0);
    if (!withItems.length) {
      return 'No itemized goods/pricing table was extracted from this document. The line-item list may be in a schedule/annex the extractor could not parse. You can still ask about total cost, delivery, payment terms, or warranty — or use deep document search for the contract wording.';
    }
    return withItems
      .map((s) => {
        const lines = s.lineItems.map((li) => {
          const qty = li.quantity != null ? ` ×${li.quantity}` : '';
          const price = li.unitPrice != null ? ` — ${formatCurrency(li.unitPrice, li.currency)}` : '';
          return `   • ${li.name}${qty}${price}`;
        });
        return `${s.supplierName}:\n${lines.join('\n')}`;
      })
      .join('\n\n');
  }

  // 2) Warranty threshold ("warranty longer than 12 months")
  const warrThresh = q.match(/warrant\w*[^0-9]*(\d+)\s*(month|year)/);
  if (warrThresh && /(longer|more|over|above|greater|at least|>|than)/.test(q)) {
    const n = parseInt(warrThresh[1], 10) * (/year/.test(warrThresh[2]) ? 12 : 1);
    const matches = qs.filter((s) => warrantyMonths(s.warranty) > n);
    if (!matches.length) return `No supplier offers a warranty longer than ${n} months.`;
    return `Suppliers with warranty over ${n} months:\n${matches
      .map((s) => `• ${s.supplierName}: ${s.warranty}`)
      .join('\n')}`;
  }

  // 3) Highest-risk query
  if (/(highest|most|biggest|worst).*(risk|riskiest)|riskiest|most risky/.test(q)) {
    const ranked = qs
      .map((s) => ({ supplier: s.supplierName, score: riskScoreFor(s.supplierName, analysis.risks) }))
      .sort((a, b) => b.score - a.score);
    if (!ranked[0]?.score) return 'No material risks were detected for any supplier.';
    const top = ranked[0];
    const flags = analysis.risks.filter((r) => r.supplier === top.supplier);
    return `${top.supplier} has the highest risk:\n${flags.map((f) => `⚠ ${f.message}`).join('\n')}`;
  }

  if (/(cheap|lowest|least|price|cost|budget)/.test(q) && rec.lowestCost) {
    return `${rec.lowestCost.supplier} is the cheapest — ${rec.lowestCost.detail}`;
  }
  if (/(fast|quick|deliver|lead time|soonest)/.test(q) && rec.fastestDelivery) {
    return `${rec.fastestDelivery.supplier} delivers fastest — ${rec.fastestDelivery.detail}`;
  }
  if (/(payment|terms|net)/.test(q)) {
    const lines = qs.map((s) => `• ${s.supplierName}: ${s.paymentTerms ?? 'not specified'}`);
    return `Payment terms by supplier:\n${lines.join('\n')}`;
  }
  if (/(warrant)/.test(q)) {
    const lines = qs.map((s) => `• ${s.supplierName}: ${s.warranty ?? 'no warranty info'}`);
    return `Warranty coverage:\n${lines.join('\n')}`;
  }
  if (/(best|recommend|overall|should|pick|choose)/.test(q) && rec.bestOverall) {
    return `I recommend ${rec.bestOverall.supplier} — ${rec.bestOverall.detail}`;
  }
  if (analysis.risks.length && /(risk|concern|problem|issue|warn)/.test(q)) {
    return `Risks I found:\n${analysis.risks.map((r) => `⚠ ${r.message}`).join('\n')}`;
  }

  // Generic summary
  const lines = qs.map(
    (s) =>
      `• ${s.supplierName}: ${money(s.totalCost ?? 0)}, ${
        s.deliveryDays ?? '—'
      } days, ${s.paymentTerms ?? '—'}`,
  );
  return `Here's a quick comparison:\n${lines.join('\n')}${
    rec.bestOverall ? `\n\nMy pick: ${rec.bestOverall.supplier}.` : ''
  }`;
}
