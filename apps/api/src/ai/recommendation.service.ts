import { Injectable } from '@nestjs/common';
import { OpenAiService } from './openai.service';

export interface QuotationSummary {
  id: string;
  supplierName: string;
  totalPrice: number | null;
  currency: string | null;
  deliveryDays: number | null;
  paymentTerms: string | null;
  reliabilityScore: number;
}

export interface RecommendationHighlights {
  lowestCostQuotationId: string | null;
  fastestDeliveryQuotationId: string | null;
  mostReliableQuotationId: string | null;
  bestBalanceQuotationId: string | null;
  bullets: string[];
}

export interface RecommendationResult {
  recommendedQuotationId: string | null;
  summary: string;
  highlights: RecommendationHighlights;
  model: string | null;
}

@Injectable()
export class RecommendationService {
  constructor(private readonly openai: OpenAiService) {}

  async recommend(
    quotes: QuotationSummary[],
    context: { title: string; budget?: number | null },
  ): Promise<RecommendationResult> {
    if (quotes.length === 0) {
      return {
        recommendedQuotationId: null,
        summary: 'No quotations available to compare yet.',
        highlights: this.emptyHighlights(),
        model: null,
      };
    }

    const highlights = this.computeHighlights(quotes);

    // Build a deterministic narrative; enrich with AI when available.
    const baseSummary = this.buildBaseSummary(quotes, highlights);

    if (this.openai.isEnabled) {
      const ai = await this.openai.complete(
        `You are a senior procurement advisor. Given supplier quotations and computed metrics, write a concise (3-5 sentence) recommendation. Be specific, mention supplier names and figures, and justify the recommended supplier on cost, delivery, and reliability trade-offs.`,
        JSON.stringify({ request: context, quotes, metrics: highlights }, null, 2),
        { temperature: 0.3, maxTokens: 400 },
      );
      if (ai) {
        return {
          recommendedQuotationId: highlights.bestBalanceQuotationId,
          summary: ai,
          highlights,
          model: 'openai',
        };
      }
    }

    return {
      recommendedQuotationId: highlights.bestBalanceQuotationId,
      summary: baseSummary,
      highlights,
      model: null,
    };
  }

  private computeHighlights(quotes: QuotationSummary[]): RecommendationHighlights {
    const withPrice = quotes.filter((q) => q.totalPrice && q.totalPrice > 0);
    const withDelivery = quotes.filter((q) => q.deliveryDays && q.deliveryDays > 0);

    const lowestCost = withPrice.sort(
      (a, b) => (a.totalPrice ?? 0) - (b.totalPrice ?? 0),
    )[0];
    const fastest = withDelivery.sort(
      (a, b) => (a.deliveryDays ?? 0) - (b.deliveryDays ?? 0),
    )[0];
    const mostReliable = [...quotes].sort(
      (a, b) => b.reliabilityScore - a.reliabilityScore,
    )[0];

    // Weighted balance score: cost 45%, delivery 30%, reliability 25%
    const bestBalance = this.scoreBalance(quotes);

    const bullets: string[] = [];
    if (lowestCost)
      bullets.push(
        `${lowestCost.supplierName} offers the lowest total cost (${this.money(lowestCost)}).`,
      );
    if (fastest)
      bullets.push(
        `${fastest.supplierName} provides the fastest delivery (${fastest.deliveryDays} days).`,
      );
    if (mostReliable)
      bullets.push(
        `${mostReliable.supplierName} has the highest reliability score (${mostReliable.reliabilityScore}/100).`,
      );
    if (bestBalance)
      bullets.push(
        `${bestBalance.supplierName} offers the best balance of cost, delivery time, and reliability.`,
      );

    return {
      lowestCostQuotationId: lowestCost?.id ?? null,
      fastestDeliveryQuotationId: fastest?.id ?? null,
      mostReliableQuotationId: mostReliable?.id ?? null,
      bestBalanceQuotationId: bestBalance?.id ?? null,
      bullets,
    };
  }

  private scoreBalance(quotes: QuotationSummary[]): QuotationSummary | undefined {
    const prices = quotes.map((q) => q.totalPrice ?? Infinity);
    const days = quotes.map((q) => q.deliveryDays ?? Infinity);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices.filter((p) => p !== Infinity), minPrice);
    const minDays = Math.min(...days);
    const maxDays = Math.max(...days.filter((d) => d !== Infinity), minDays);

    const norm = (v: number, min: number, max: number) =>
      max === min ? 1 : 1 - (v - min) / (max - min); // higher is better

    let best: QuotationSummary | undefined;
    let bestScore = -Infinity;
    for (const q of quotes) {
      const costScore = q.totalPrice ? norm(q.totalPrice, minPrice, maxPrice) : 0;
      const deliveryScore = q.deliveryDays
        ? norm(q.deliveryDays, minDays, maxDays)
        : 0;
      const reliabilityScore = q.reliabilityScore / 100;
      const total =
        costScore * 0.45 + deliveryScore * 0.3 + reliabilityScore * 0.25;
      if (total > bestScore) {
        bestScore = total;
        best = q;
      }
    }
    return best;
  }

  private buildBaseSummary(
    quotes: QuotationSummary[],
    h: RecommendationHighlights,
  ): string {
    return h.bullets.join(' ');
  }

  private money(q: QuotationSummary): string {
    return `${q.currency ?? ''} ${q.totalPrice?.toLocaleString() ?? 'N/A'}`.trim();
  }

  private emptyHighlights(): RecommendationHighlights {
    return {
      lowestCostQuotationId: null,
      fastestDeliveryQuotationId: null,
      mostReliableQuotationId: null,
      bestBalanceQuotationId: null,
      bullets: [],
    };
  }
}
