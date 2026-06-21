import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@prisma/client';

export interface QuotationRiskInput {
  id: string;
  supplierName?: string | null;
  totalPrice?: number | null;
  deliveryTime?: string | null;
  deliveryDays?: number | null;
  paymentTerms?: string | null;
  itemCount: number;
}

export interface RiskResult {
  quotationId: string;
  riskLevel: RiskLevel;
  riskScore: number; // 0-100, higher = riskier
  warnings: string[];
}

/**
 * Rule-based risk detection. Compares each quotation against the cohort to
 * surface missing data, incomplete quotes, and pricing outliers.
 */
@Injectable()
export class RiskService {
  detect(
    quotations: QuotationRiskInput[],
    context: { budget?: number | null; requiredItemsCount?: number } = {},
  ): RiskResult[] {
    const prices = quotations
      .map((q) => q.totalPrice)
      .filter((p): p is number => typeof p === 'number' && p > 0);

    const mean = prices.length
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 0;
    const stdDev = prices.length
      ? Math.sqrt(
          prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length,
        )
      : 0;

    return quotations.map((q) => {
      const warnings: string[] = [];
      let score = 0;

      // Missing / incomplete data
      if (!q.totalPrice || q.totalPrice <= 0) {
        warnings.push('Missing or zero total price');
        score += 35;
      }
      if (!q.deliveryDays && !q.deliveryTime) {
        warnings.push('Missing delivery date / lead time');
        score += 20;
      }
      if (!q.paymentTerms) {
        warnings.push('Missing payment terms');
        score += 10;
      }
      if (q.itemCount === 0) {
        warnings.push('No line items extracted — incomplete quotation');
        score += 25;
      }
      if (
        context.requiredItemsCount &&
        q.itemCount > 0 &&
        q.itemCount < context.requiredItemsCount
      ) {
        warnings.push(
          `Only ${q.itemCount} of ${context.requiredItemsCount} required items quoted`,
        );
        score += 15;
      }

      // Pricing outliers (vs cohort)
      if (q.totalPrice && prices.length >= 2 && stdDev > 0) {
        const z = (q.totalPrice - mean) / stdDev;
        if (z > 1.75) {
          warnings.push(
            `Unusually high price (${Math.round((q.totalPrice / mean - 1) * 100)}% above average)`,
          );
          score += 25;
        } else if (z < -1.75) {
          warnings.push(
            `Unusually low price (${Math.round((1 - q.totalPrice / mean) * 100)}% below average) — verify scope`,
          );
          score += 20;
        }
      }

      // Budget overrun
      if (context.budget && q.totalPrice && q.totalPrice > context.budget) {
        warnings.push(
          `Exceeds budget by ${Math.round((q.totalPrice / context.budget - 1) * 100)}%`,
        );
        score += 15;
      }

      // Extremely long delivery
      if (q.deliveryDays && q.deliveryDays > 90) {
        warnings.push(`Very long delivery time (${q.deliveryDays} days)`);
        score += 10;
      }

      score = Math.min(100, score);
      const riskLevel: RiskLevel =
        score >= 50 ? RiskLevel.HIGH : score >= 20 ? RiskLevel.MEDIUM : RiskLevel.LOW;

      return { quotationId: q.id, riskLevel, riskScore: score, warnings };
    });
  }
}
