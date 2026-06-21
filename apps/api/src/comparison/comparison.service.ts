import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RiskService } from '../ai/risk.service';
import {
  RecommendationService,
  QuotationSummary,
} from '../ai/recommendation.service';

export interface ComparisonRow {
  quotationId: string;
  supplierName: string;
  supplierId: string | null;
  reliabilityScore: number;
  totalPrice: number | null;
  currency: string | null;
  deliveryDays: number | null;
  deliveryTime: string | null;
  paymentTerms: string | null;
  itemCount: number;
  status: string;
  riskLevel: string | null;
  riskScore: number | null;
  warnings: string[];
  isLowestCost: boolean;
  isFastest: boolean;
  isMostReliable: boolean;
  isRecommended: boolean;
}

@Injectable()
export class ComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
    private readonly recommendation: RecommendationService,
  ) {}

  /**
   * Builds the full comparison view for a request:
   * table rows + risk analysis + AI recommendation.
   * Persists recommendation and per-quotation risk for reuse.
   */
  async compare(requestId: string) {
    const request = await this.prisma.procurementRequest.findUnique({
      where: { id: requestId },
      include: {
        quotations: { include: { items: true, supplier: true } },
      },
    });
    if (!request) throw new NotFoundException('Procurement request not found');

    const quotations = request.quotations;

    // Risk detection across the cohort
    const riskResults = this.risk.detect(
      quotations.map((q) => ({
        id: q.id,
        supplierName: q.supplierName,
        totalPrice: q.totalPrice ? Number(q.totalPrice) : null,
        deliveryTime: q.deliveryTime,
        deliveryDays: q.deliveryDays,
        paymentTerms: q.paymentTerms,
        itemCount: q.items.length,
      })),
      {
        budget: request.budget ? Number(request.budget) : null,
        requiredItemsCount: this.countRequiredItems(request.requiredItems),
      },
    );
    const riskMap = new Map(riskResults.map((r) => [r.quotationId, r]));

    // Persist risk back onto quotations
    await Promise.all(
      riskResults.map((r) =>
        this.prisma.quotation.update({
          where: { id: r.quotationId },
          data: {
            riskLevel: r.riskLevel,
            riskScore: r.riskScore,
            warnings: r.warnings as unknown as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    // Recommendation
    const summaries: QuotationSummary[] = quotations.map((q) => ({
      id: q.id,
      supplierName: q.supplierName ?? q.supplier?.companyName ?? 'Unknown supplier',
      totalPrice: q.totalPrice ? Number(q.totalPrice) : null,
      currency: q.currency,
      deliveryDays: q.deliveryDays,
      paymentTerms: q.paymentTerms,
      reliabilityScore: q.supplier?.reliabilityScore ?? 50,
    }));

    const rec = await this.recommendation.recommend(summaries, {
      title: request.title,
      budget: request.budget ? Number(request.budget) : null,
    });

    if (quotations.length > 0) {
      await this.prisma.recommendation.upsert({
        where: { requestId },
        create: {
          requestId,
          recommendedQuotationId: rec.recommendedQuotationId,
          summary: rec.summary,
          highlights: rec.highlights as unknown as Prisma.InputJsonValue,
          model: rec.model,
        },
        update: {
          recommendedQuotationId: rec.recommendedQuotationId,
          summary: rec.summary,
          highlights: rec.highlights as unknown as Prisma.InputJsonValue,
          model: rec.model,
        },
      });
    }

    const rows: ComparisonRow[] = quotations.map((q) => {
      const r = riskMap.get(q.id);
      return {
        quotationId: q.id,
        supplierName: q.supplierName ?? q.supplier?.companyName ?? 'Unknown supplier',
        supplierId: q.supplierId,
        reliabilityScore: q.supplier?.reliabilityScore ?? 50,
        totalPrice: q.totalPrice ? Number(q.totalPrice) : null,
        currency: q.currency,
        deliveryDays: q.deliveryDays,
        deliveryTime: q.deliveryTime,
        paymentTerms: q.paymentTerms,
        itemCount: q.items.length,
        status: q.status,
        riskLevel: r?.riskLevel ?? null,
        riskScore: r?.riskScore ?? null,
        warnings: r?.warnings ?? [],
        isLowestCost: rec.highlights.lowestCostQuotationId === q.id,
        isFastest: rec.highlights.fastestDeliveryQuotationId === q.id,
        isMostReliable: rec.highlights.mostReliableQuotationId === q.id,
        isRecommended: rec.recommendedQuotationId === q.id,
      };
    });

    return {
      request: {
        id: request.id,
        title: request.title,
        budget: request.budget ? Number(request.budget) : null,
        currency: request.currency,
        requiredDeliveryDate: request.requiredDeliveryDate,
        status: request.status,
      },
      rows,
      recommendation: rec,
      summary: {
        quotationCount: quotations.length,
        lowestCost: this.min(rows.map((r) => r.totalPrice)),
        highestCost: this.max(rows.map((r) => r.totalPrice)),
        fastestDeliveryDays: this.min(rows.map((r) => r.deliveryDays)),
        highRiskCount: rows.filter((r) => r.riskLevel === 'HIGH').length,
      },
    };
  }

  private countRequiredItems(items?: string | null): number | undefined {
    if (!items) return undefined;
    const lines = items.split(/\n|,/).map((l) => l.trim()).filter(Boolean);
    return lines.length || undefined;
  }

  private min(values: (number | null)[]): number | null {
    const nums = values.filter((v): v is number => typeof v === 'number');
    return nums.length ? Math.min(...nums) : null;
  }

  private max(values: (number | null)[]): number | null {
    const nums = values.filter((v): v is number => typeof v === 'number');
    return nums.length ? Math.max(...nums) : null;
  }
}
