import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, Quotation, QuotationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from '../ai/document-parser.service';
import { ExtractionService } from '../ai/extraction.service';
import { ChatService } from '../ai/chat.service';
import { QuotationsRepository } from './quotations.repository';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly repo: QuotationsRepository,
    private readonly storage: StorageService,
    private readonly parser: DocumentParserService,
    private readonly extraction: ExtractionService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
  ) {}

  /** Uploads file(s) to storage and kicks off AI processing for each. */
  async uploadMany(
    requestId: string,
    files: UploadedFile[],
    userId: string,
    supplierId?: string,
  ) {
    const created: Quotation[] = [];
    for (const file of files) {
      const stored = await this.storage.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      const quotation = await this.repo.create({
        requestId,
        supplierId: supplierId ?? null,
        fileName: file.originalname,
        fileKey: stored.key,
        fileMimeType: file.mimetype,
        fileSize: file.size,
        status: QuotationStatus.UPLOADED,
      });
      await this.audit.log({
        userId,
        action: AuditAction.UPLOAD,
        entityType: 'Quotation',
        entityId: quotation.id,
        metadata: { fileName: file.originalname, requestId },
      });
      created.push(quotation);

      // Fire-and-forget processing so the upload response is fast.
      this.process(quotation.id, userId).catch((err) =>
        this.logger.error(`Processing failed for ${quotation.id}: ${err.message}`),
      );
    }
    return created;
  }

  /** Full processing pipeline: parse -> extract -> persist -> index. */
  async process(quotationId: string, userId?: string) {
    const quotation = await this.repo.findById(quotationId);
    if (!quotation) throw new NotFoundException('Quotation not found');

    await this.repo.update(quotationId, { status: QuotationStatus.PROCESSING });

    try {
      const buffer = await this.storage.getObjectBuffer(quotation.fileKey);
      const text = await this.parser.extractText(buffer, quotation.fileMimeType);
      const extracted = await this.extraction.extract(text);

      // Try to associate a supplier from the extracted name
      let supplierId = quotation.supplierId;
      if (!supplierId && extracted.supplierName) {
        const match = await this.repo.findSupplierByName(extracted.supplierName);
        if (match) supplierId = match.id;
      }

      await this.repo.update(quotationId, {
        status: QuotationStatus.EXTRACTED,
        supplierId,
        supplierName: extracted.supplierName,
        currency: extracted.currency,
        totalPrice: extracted.totalPrice ?? undefined,
        deliveryTime: extracted.deliveryTime,
        deliveryDays: extracted.deliveryDays ?? undefined,
        paymentTerms: extracted.paymentTerms,
        extractedText: text,
        rawExtraction: extracted as unknown as Prisma.InputJsonValue,
      });

      if (extracted.items.length > 0) {
        await this.repo.replaceItems(
          quotationId,
          extracted.items.map((i) => ({
            quotationId,
            productName: i.productName,
            quantity: i.quantity ?? undefined,
            unitPrice: i.unitPrice ?? undefined,
            totalPrice: i.totalPrice ?? undefined,
            currency: i.currency ?? undefined,
          })),
        );
      }

      // Build RAG index
      await this.chat.indexQuotation(quotationId);

      await this.audit.log({
        userId: userId ?? null,
        action: AuditAction.EXTRACT,
        entityType: 'Quotation',
        entityId: quotationId,
        metadata: { items: extracted.items.length },
      });

      return this.repo.findById(quotationId);
    } catch (err) {
      this.logger.error(`Extraction error: ${(err as Error).message}`);
      await this.repo.update(quotationId, { status: QuotationStatus.FAILED });
      throw err;
    }
  }

  findByRequest(requestId: string) {
    return this.repo.findByRequest(requestId);
  }

  async findOne(id: string) {
    const q = await this.repo.findById(id);
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async getDownloadUrl(id: string) {
    const q = await this.findOne(id);
    const url = await this.storage.getDownloadUrl(q.fileKey);
    return { url };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.repo.delete(id);
    await this.audit.log({
      userId,
      action: AuditAction.DELETE,
      entityType: 'Quotation',
      entityId: id,
    });
    return { success: true };
  }
}
