import { Injectable } from '@nestjs/common';
import { RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aggregated KPIs for the analytics dashboard. */
  async overview() {
    const [requests, quotations, suppliers, awardedRequests] = await Promise.all([
      this.prisma.procurementRequest.findMany({
        select: { id: true, createdAt: true, budget: true, currency: true },
      }),
      this.prisma.quotation.findMany({
        select: {
          id: true,
          createdAt: true,
          totalPrice: true,
          requestId: true,
          supplierId: true,
          supplierName: true,
          supplier: { select: { companyName: true } },
          request: { select: { createdAt: true } },
        },
      }),
      this.prisma.supplier.count(),
      this.prisma.procurementRequest.findMany({
        where: { status: RequestStatus.AWARDED, awardedQuotationId: { not: null } },
        include: { awardedQuotation: true, quotations: true },
      }),
    ]);

    return {
      kpis: {
        totalRequests: requests.length,
        totalQuotations: quotations.length,
        totalSuppliers: suppliers,
        awardedRequests: awardedRequests.length,
        avgQuotationResponseHours: this.avgResponseHours(quotations),
        estimatedSavings: this.estimatedSavings(awardedRequests),
      },
      monthlySpend: this.monthlySpend(awardedRequests),
      procurementVolume: this.monthlyVolume(requests),
      topSuppliers: this.topSuppliers(quotations),
    };
  }

  /** Average hours between a request being created and a quotation arriving. */
  private avgResponseHours(
    quotations: { createdAt: Date; request: { createdAt: Date } | null }[],
  ): number {
    const diffs = quotations
      .filter((q) => q.request)
      .map(
        (q) =>
          (q.createdAt.getTime() - q.request!.createdAt.getTime()) /
          (1000 * 60 * 60),
      )
      .filter((h) => h >= 0);
    if (!diffs.length) return 0;
    return Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
  }

  /** Savings = budget (or highest quote) minus awarded price, per request. */
  private estimatedSavings(
    awarded: {
      budget: any;
      awardedQuotation: { totalPrice: any } | null;
      quotations: { totalPrice: any }[];
    }[],
  ): number {
    let savings = 0;
    for (const r of awarded) {
      const awardedPrice = r.awardedQuotation?.totalPrice
        ? Number(r.awardedQuotation.totalPrice)
        : null;
      if (awardedPrice === null) continue;
      const prices = r.quotations
        .map((q) => (q.totalPrice ? Number(q.totalPrice) : null))
        .filter((p): p is number => p !== null);
      const baseline =
        r.budget != null ? Number(r.budget) : prices.length ? Math.max(...prices) : null;
      if (baseline != null && baseline > awardedPrice) {
        savings += baseline - awardedPrice;
      }
    }
    return Math.round(savings);
  }

  private monthlySpend(
    awarded: { awardedQuotation: { totalPrice: any; createdAt: Date } | null }[],
  ) {
    const map = new Map<string, number>();
    for (const r of awarded) {
      if (!r.awardedQuotation?.totalPrice) continue;
      const key = this.monthKey(r.awardedQuotation.createdAt);
      map.set(key, (map.get(key) ?? 0) + Number(r.awardedQuotation.totalPrice));
    }
    return this.toSeries(map);
  }

  private monthlyVolume(requests: { createdAt: Date }[]) {
    const map = new Map<string, number>();
    for (const r of requests) {
      const key = this.monthKey(r.createdAt);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return this.toSeries(map);
  }

  private topSuppliers(
    quotations: {
      supplierId: string | null;
      supplierName: string | null;
      totalPrice: any;
      supplier: { companyName: string } | null;
    }[],
  ) {
    const map = new Map<string, { name: string; quotes: number; value: number }>();
    for (const q of quotations) {
      const name =
        q.supplier?.companyName ?? q.supplierName ?? 'Unknown supplier';
      const key = q.supplierId ?? name;
      const entry = map.get(key) ?? { name, quotes: 0, value: 0 };
      entry.quotes += 1;
      entry.value += q.totalPrice ? Number(q.totalPrice) : 0;
      map.set(key, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.quotes - a.quotes)
      .slice(0, 8);
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private toSeries(map: Map<string, number>) {
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, value: Math.round(value) }));
  }
}
