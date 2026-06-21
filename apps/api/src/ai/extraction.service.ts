import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from './openai.service';

export interface ExtractedItem {
  productName: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
}

export interface ExtractedQuotation {
  supplierName: string | null;
  currency: string | null;
  totalPrice: number | null;
  deliveryTime: string | null;
  deliveryDays: number | null;
  paymentTerms: string | null;
  items: ExtractedItem[];
}

const SYSTEM_PROMPT = `You are an expert procurement analyst. Extract structured data from a supplier quotation document.
Return ONLY a JSON object with this exact shape:
{
  "supplierName": string | null,
  "currency": string | null,         // ISO code like "USD", "EUR" if determinable
  "totalPrice": number | null,       // grand total as a number, no symbols
  "deliveryTime": string | null,     // e.g. "14 days", "3-4 weeks"
  "deliveryDays": number | null,     // delivery time normalized to days
  "paymentTerms": string | null,     // e.g. "Net 30", "50% advance"
  "items": [
    {
      "productName": string,
      "quantity": number | null,
      "unitPrice": number | null,
      "totalPrice": number | null,
      "currency": string | null
    }
  ]
}
Rules:
- Numbers must be plain numbers (strip currency symbols and thousands separators).
- If a field is not present, use null.
- "deliveryDays": convert weeks to days (1 week = 7), pick the upper bound for ranges.
- Never invent values that are not in the document.`;

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(private readonly openai: OpenAiService) {}

  async extract(text: string): Promise<ExtractedQuotation> {
    const clipped = text.slice(0, 15000); // keep token usage bounded

    if (this.openai.isEnabled) {
      const result = await this.openai.completeJson<ExtractedQuotation>(
        SYSTEM_PROMPT,
        `Quotation document text:\n"""\n${clipped}\n"""`,
      );
      if (result) return this.normalize(result);
      this.logger.warn('AI extraction returned null — using heuristic fallback');
    }
    return this.heuristicExtract(clipped);
  }

  private normalize(r: ExtractedQuotation): ExtractedQuotation {
    return {
      supplierName: r.supplierName ?? null,
      currency: r.currency ?? null,
      totalPrice: this.num(r.totalPrice),
      deliveryTime: r.deliveryTime ?? null,
      deliveryDays: this.num(r.deliveryDays),
      paymentTerms: r.paymentTerms ?? null,
      items: Array.isArray(r.items)
        ? r.items.map((i) => ({
            productName: String(i.productName ?? 'Unknown item'),
            quantity: this.num(i.quantity),
            unitPrice: this.num(i.unitPrice),
            totalPrice: this.num(i.totalPrice),
            currency: i.currency ?? r.currency ?? null,
          }))
        : [],
    };
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Regex-based fallback extractor — best effort when no LLM is available.
   * Covers the most common quotation patterns.
   */
  private heuristicExtract(text: string): ExtractedQuotation {
    const currency =
      /\b(USD|EUR|GBP|AED|SAR|PKR|INR|CNY)\b/i.exec(text)?.[1]?.toUpperCase() ??
      (/\$/.test(text) ? 'USD' : /€/.test(text) ? 'EUR' : null);

    const totalMatch =
      /(?:grand\s*total|total\s*(?:amount|price)?)\s*[:\-]?\s*[^0-9]{0,4}([\d.,]+)/i.exec(
        text,
      );
    const totalPrice = totalMatch ? this.num(totalMatch[1].replace(/,/g, '')) : null;

    const deliveryMatch =
      /(?:delivery|lead\s*time)\s*[:\-]?\s*([\w\s\-]+?(?:days?|weeks?|months?))/i.exec(
        text,
      );
    const deliveryTime = deliveryMatch ? deliveryMatch[1].trim() : null;
    const deliveryDays = deliveryTime ? this.parseDays(deliveryTime) : null;

    const paymentMatch =
      /(?:payment\s*terms?)\s*[:\-]?\s*([^\n]{3,60})/i.exec(text);
    const paymentTerms = paymentMatch ? paymentMatch[1].trim() : null;

    const supplierMatch =
      /(?:from|supplier|company|quotation\s*by)\s*[:\-]?\s*([A-Z][\w&.,'\- ]{2,60})/i.exec(
        text,
      );

    return {
      supplierName: supplierMatch ? supplierMatch[1].trim() : null,
      currency,
      totalPrice,
      deliveryTime,
      deliveryDays,
      paymentTerms,
      items: [],
    };
  }

  private parseDays(s: string): number | null {
    const m = /([\d.]+)\s*(day|week|month)/i.exec(s);
    if (!m) return null;
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('week')) return Math.round(value * 7);
    if (unit.startsWith('month')) return Math.round(value * 30);
    return Math.round(value);
  }
}
