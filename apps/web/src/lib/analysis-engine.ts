// Deterministic, realistic quotation analysis used by the MVP.
//
// Real extraction (PDF/DOCX/OCR) is the documented next step — it can be
// swapped in behind /api/extract without changing the UI, since this module
// produces the same AnalysisResult shape.

import { DEFAULT_WEIGHTS } from './workspace-types';
import type {
  AnalysisResult,
  ExtractedQuotation,
  FieldKey,
  FieldProvenance,
  Recommendation,
  RiskFlag,
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

// Simulated source snippet + confidence per field (real OCR/extraction is the
// documented next step). A null value yields confidence 0 → rendered "Not found".
function buildFields(
  q: Omit<ExtractedQuotation, 'fields'>,
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
            snippet: `Grand Total: ${money(q.totalCost)} ${q.currency}`,
            page: 2,
            confidence: conf(0.85, 5),
          },
    deliveryDays:
      q.deliveryDays == null
        ? { snippet: null, confidence: 0 }
        : {
            snippet: `Estimated delivery: ${q.deliveryDays} days from PO`,
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
  cost: number;
  delivery: number;
  terms: string;
  warranty: string | null;
}[] = [
  // Cheapest, but slowest AND no warranty (problem).
  { cost: 8900, delivery: 26, terms: 'Net 60', warranty: null },
  // Fastest, but most expensive AND risky payment terms (problem).
  { cost: 14500, delivery: 7, terms: '100% advance payment', warranty: '12 months' },
  // Mid-priced with the best warranty → typically best overall.
  { cost: 10500, delivery: 10, terms: 'Net 30', warranty: '36 months' },
  // Solid all-rounder, no red flags (for contrast).
  { cost: 11200, delivery: 11, terms: 'Net 45', warranty: '24 months' },
];

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
    const jitter = (h % 600) - 300; // ±$300 so repeats differ
    const deliveryJitter = (h >> 4) % 3; // 0-2 extra days
    const base = {
      id: `q_${i}`,
      fileName,
      supplierName: prettySupplier(fileName, i),
      totalCost: profile.cost + jitter,
      currency: 'USD',
      deliveryDays: profile.delivery + deliveryJitter,
      paymentTerms: profile.terms,
      warranty: profile.warranty,
    };
    return { ...base, fields: buildFields(base, h) };
  });

  const risks = detectRisks(quotations);
  return {
    quotations,
    recommendation: buildRecommendation(quotations, risks),
    risks,
    simulated: true,
  };
}

export function buildRecommendation(
  qs: ExtractedQuotation[],
  risks: RiskFlag[],
): Recommendation {
  const withCost = qs.filter((q) => q.totalCost != null);
  const withDelivery = qs.filter((q) => q.deliveryDays != null);
  const rec: Recommendation = {};

  if (withCost.length) {
    const cheapest = withCost.reduce((a, b) => (a.totalCost! <= b.totalCost! ? a : b));
    rec.lowestCost = {
      supplier: cheapest.supplierName,
      detail: `Lowest total cost at ${money(cheapest.totalCost!)}.`,
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
  missing_warranty: 2,
  long_lead_time: 1,
  unusual_pricing: 1,
};

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

  const prices = quotations.map((q) => q.totalCost ?? 0);
  const deliveries = quotations.map((q) => q.deliveryDays ?? 0);
  const warranties = quotations.map((q) => warrantyMonths(q.warranty));
  const riskScores = quotations.map((q) => riskScoreFor(q.supplierName, risks));

  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minD = Math.min(...deliveries), maxD = Math.max(...deliveries);
  const minW = Math.min(...warranties), maxW = Math.max(...warranties);
  const maxRisk = Math.max(...riskScores);
  const allRiskEqual = riskScores.every((r) => r === riskScores[0]);

  // Renormalize weights so they always sum to 1 (guard the all-zero case).
  const sum = weights.price + weights.delivery + weights.warranty + weights.risk;
  const w =
    sum > 0
      ? {
          price: weights.price / sum,
          delivery: weights.delivery / sum,
          warranty: weights.warranty / sum,
          risk: weights.risk / sum,
        }
      : { price: 0.25, delivery: 0.25, warranty: 0.25, risk: 0.25 };

  return quotations
    .map<SupplierScore>((q, i) => {
      const price = normalize(prices[i], minP, maxP, false); // lower is better
      const delivery = normalize(deliveries[i], minD, maxD, false); // lower is better
      const warranty = normalize(warranties[i], minW, maxW, true); // higher is better
      const risk = allRiskEqual ? 1 : 1 - riskScores[i] / maxRisk; // fewer/less severe is better
      const overall =
        w.price * price + w.delivery * delivery + w.warranty * warranty + w.risk * risk;
      return { quotation: q, price, delivery, warranty, risk, overall };
    })
    .sort((a, b) => b.overall - a.overall);
}

export function detectRisks(qs: ExtractedQuotation[]): RiskFlag[] {
  const risks: RiskFlag[] = [];
  const costs = qs.filter((q) => q.totalCost != null).map((q) => q.totalCost!);
  const med = costs.length ? median(costs) : 0;

  for (const q of qs) {
    if (q.deliveryDays == null) {
      risks.push({
        supplier: q.supplierName,
        type: 'missing_delivery',
        message: `${q.supplierName}: no delivery date provided.`,
      });
    } else if (q.deliveryDays >= 14) {
      risks.push({
        supplier: q.supplierName,
        type: 'long_lead_time',
        message: `${q.supplierName}: ${q.deliveryDays}-day lead time may delay milestones.`,
      });
    }

    if (!q.warranty) {
      risks.push({
        supplier: q.supplierName,
        type: 'missing_warranty',
        message: `${q.supplierName}: no warranty information found.`,
      });
    }

    if (q.paymentTerms && isRiskyPaymentTerms(q.paymentTerms)) {
      risks.push({
        supplier: q.supplierName,
        type: 'risky_payment_terms',
        message: `${q.supplierName}: payment terms "${q.paymentTerms}" require payment upfront / reduce buyer protection.`,
      });
    }

    if (q.totalCost != null && med > 0 && q.totalCost > med * 1.25) {
      risks.push({
        supplier: q.supplierName,
        type: 'unusual_pricing',
        message: `${q.supplierName}: priced ${Math.round(
          ((q.totalCost - med) / med) * 100,
        )}% above the median quote.`,
      });
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
