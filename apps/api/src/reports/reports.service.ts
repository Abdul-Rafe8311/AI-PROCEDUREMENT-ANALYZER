import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { ComparisonService } from '../comparison/comparison.service';
import { buildReportPdf } from './pdf.builder';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly comparison: ComparisonService,
    private readonly audit: AuditService,
  ) {}

  /** Generates a PDF report for a request, stores it, and records it. */
  async generate(requestId: string, user: { id: string; name?: string }) {
    const comparison = await this.comparison.compare(requestId);
    const request = await this.prisma.procurementRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Procurement request not found');

    const pdf = await buildReportPdf({
      request: {
        title: request.title,
        description: request.description,
        budget: request.budget ? Number(request.budget) : null,
        currency: request.currency,
        requiredDeliveryDate: request.requiredDeliveryDate,
        quantity: request.quantity,
        requiredItems: request.requiredItems,
      },
      rows: comparison.rows,
      recommendation: {
        summary: comparison.recommendation.summary,
        bullets: comparison.recommendation.highlights.bullets,
      },
      generatedBy: user.name,
    });

    const fileName = `report-${request.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}.pdf`;
    const stored = await this.storage.upload(
      pdf,
      fileName,
      'application/pdf',
      'reports',
    );

    const report = await this.prisma.report.create({
      data: {
        requestId,
        generatedById: user.id,
        title: `Procurement Report — ${request.title}`,
        fileKey: stored.key,
        fileSize: stored.size,
        summary: {
          generatedAt: new Date().toISOString(),
          recommendedQuotationId:
            comparison.recommendation.recommendedQuotationId,
          quotationCount: comparison.summary.quotationCount,
        },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.GENERATE_REPORT,
      entityType: 'Report',
      entityId: report.id,
      metadata: { requestId },
    });

    const url = await this.storage.getDownloadUrl(stored.key);
    return { ...report, downloadUrl: url };
  }

  async findByRequest(requestId: string) {
    return this.prisma.report.findMany({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async download(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    const url = await this.storage.getDownloadUrl(report.fileKey);
    return { url };
  }
}
