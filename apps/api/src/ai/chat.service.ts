import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiService } from './openai.service';

export interface ChatSource {
  quotationId: string;
  supplierName: string | null;
  snippet: string;
  score: number;
}

export interface ChatAnswer {
  answer: string;
  sources: ChatSource[];
}

/**
 * Retrieval Augmented Generation over a request's quotations.
 * Embeddings are stored as JSON vectors; similarity is computed in-process,
 * which keeps the stack portable (no pgvector required).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
  ) {}

  /** Splits text into overlapping chunks for embedding. */
  private chunk(text: string, size = 900, overlap = 150): string[] {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += size - overlap) {
      chunks.push(clean.slice(i, i + size));
      if (i + size >= clean.length) break;
    }
    return chunks;
  }

  /** Builds (or rebuilds) embeddings for a quotation's extracted text. */
  async indexQuotation(quotationId: string): Promise<number> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
    });
    if (!quotation?.extractedText) return 0;

    await this.prisma.quotationEmbedding.deleteMany({ where: { quotationId } });

    const chunks = this.chunk(quotation.extractedText);
    if (chunks.length === 0) return 0;

    if (!this.openai.isEnabled) {
      // Store chunks without vectors so keyword fallback search still works.
      await this.prisma.quotationEmbedding.createMany({
        data: chunks.map((content, i) => ({
          quotationId,
          requestId: quotation.requestId,
          chunkIndex: i,
          content,
          embedding: [],
        })),
      });
      return chunks.length;
    }

    const vectors = await this.openai.embed(chunks);
    await this.prisma.quotationEmbedding.createMany({
      data: chunks.map((content, i) => ({
        quotationId,
        requestId: quotation.requestId,
        chunkIndex: i,
        content,
        embedding: vectors[i] ?? [],
      })),
    });
    return chunks.length;
  }

  private cosine(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  async ask(requestId: string, question: string): Promise<ChatAnswer> {
    const embeddings = await this.prisma.quotationEmbedding.findMany({
      where: { requestId },
      include: {
        quotation: { select: { id: true, supplierName: true } },
      },
    });

    if (embeddings.length === 0) {
      return {
        answer:
          'No indexed quotation content is available for this request yet. Upload and process quotations first.',
        sources: [],
      };
    }

    // Rank chunks by similarity (vector) or keyword overlap (fallback).
    let ranked: { e: (typeof embeddings)[number]; score: number }[];
    if (this.openai.isEnabled) {
      const [qVec] = await this.openai.embed([question]);
      ranked = embeddings
        .map((e) => ({
          e,
          score: this.cosine(qVec ?? [], (e.embedding as number[]) ?? []),
        }))
        .sort((a, b) => b.score - a.score);
    } else {
      const terms = question.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      ranked = embeddings
        .map((e) => {
          const text = e.content.toLowerCase();
          const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
          return { e, score };
        })
        .sort((a, b) => b.score - a.score);
    }

    const top = ranked.slice(0, 6).filter((r) => r.score > 0);
    const sources: ChatSource[] = top.map((r) => ({
      quotationId: r.e.quotation.id,
      supplierName: r.e.quotation.supplierName,
      snippet: r.e.content.slice(0, 280),
      score: Number(r.score.toFixed(3)),
    }));

    const contextText = top
      .map(
        (r, i) =>
          `[${i + 1}] Supplier: ${r.e.quotation.supplierName ?? 'Unknown'}\n${r.e.content}`,
      )
      .join('\n\n');

    if (!this.openai.isEnabled) {
      return {
        answer:
          top.length > 0
            ? `Most relevant quotation content for "${question}":\n\n${top
                .map(
                  (r) =>
                    `• ${r.e.quotation.supplierName ?? 'Unknown supplier'}: ${r.e.content.slice(0, 200)}…`,
                )
                .join('\n')}\n\n(Enable OPENAI_API_KEY for natural-language answers.)`
            : 'No relevant content found for that question.',
        sources,
      };
    }

    const answer = await this.openai.complete(
      `You answer procurement questions strictly from the provided quotation excerpts. Cite suppliers by name. If the answer is not in the context, say so. Be concise and precise with numbers.`,
      `Question: ${question}\n\nContext:\n${contextText}`,
      { temperature: 0.1, maxTokens: 500 },
    );

    return { answer: answer || 'No answer generated.', sources };
  }
}
