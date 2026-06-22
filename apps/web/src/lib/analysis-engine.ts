// Deterministic, realistic quotation analysis used by the MVP.
//
// Real extraction (PDF/DOCX/OCR) is the documented next step — it can be
// swapped in behind /api/extract without changing the UI, since this module
// produces the same AnalysisResult shape.

import type {
  AnalysisResult,
  ExtractedQuotation,
  Recommendation,
  RiskFlag,
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
    return {
      id: `q_${i}`,
      fileName,
      supplierName: prettySupplier(fileName, i),
      totalCost: profile.cost + jitter,
      currency: 'USD',
      deliveryDays: profile.delivery + deliveryJitter,
      paymentTerms: profile.terms,
      warranty: profile.warranty,
    };
  });

  return {
    quotations,
    recommendation: buildRecommendation(quotations),
    risks: detectRisks(quotations),
    simulated: true,
  };
}

export function buildRecommendation(qs: ExtractedQuotation[]): Recommendation {
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

  // Weighted score: cost 50%, delivery 30%, warranty present 20%.
  const costs = withCost.map((q) => q.totalCost!);
  const deliveries = withDelivery.map((q) => q.deliveryDays!);
  const minCost = Math.min(...costs, Infinity);
  const maxCost = Math.max(...costs, -Infinity);
  const minDel = Math.min(...deliveries, Infinity);
  const maxDel = Math.max(...deliveries, -Infinity);

  const scored = qs.map((q) => {
    const costScore =
      q.totalCost == null || maxCost === minCost
        ? 0.5
        : (maxCost - q.totalCost) / (maxCost - minCost);
    const delScore =
      q.deliveryDays == null || maxDel === minDel
        ? 0.5
        : (maxDel - q.deliveryDays) / (maxDel - minDel);
    const warrantyScore = q.warranty ? 1 : 0;
    return { q, score: 0.5 * costScore + 0.3 * delScore + 0.2 * warrantyScore };
  });

  if (scored.length) {
    const best = scored.reduce((a, b) => (a.score >= b.score ? a : b));
    rec.bestOverall = {
      supplier: best.q.supplierName,
      detail: 'Best balance of cost, delivery, and warranty coverage.',
    };
  }

  return rec;
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
