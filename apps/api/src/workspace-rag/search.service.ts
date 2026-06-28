import { Injectable, Logger } from '@nestjs/common';
import { RagPrismaService } from './rag-prisma.service';
import { EmbeddingService } from './embedding.service';

export interface SearchAnswer {
  answer: string;
  citations: { page: number; snippet: string }[];
  status: string;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private static readonly TOP_K = 6;

  constructor(
    private readonly prisma: RagPrismaService,
    private readonly embedder: EmbeddingService,
  ) {}

  async search(documentId: string, query: string): Promise<SearchAnswer> {
    const docRows = await this.prisma.$queryRawUnsafe<
      { index_status: string | null; file_name: string | null }[]
    >(`select index_status, file_name from documents where id = $1`, documentId);
    const doc = docRows[0];
    const status = doc?.index_status ?? 'unknown';

    if (status !== 'ready') {
      return {
        status,
        citations: [],
        answer:
          status === 'indexing' || status === 'pending'
            ? 'This document is still being indexed for deep search. Please try again in a moment.'
            : 'Deep search is not available for this document.',
      };
    }

    // Embed the query only (fast regardless of document size), then vector search.
    const qVec = `[${(await this.embedder.embedOne(query)).join(',')}]`;
    const matches = await this.prisma.$queryRawUnsafe<
      { page: number; content: string; distance: number }[]
    >(
      `select page, content, embedding <=> $1::vector as distance
       from document_chunks
       where document_id = $2
       order by distance asc
       limit ${SearchService.TOP_K}`,
      qVec,
      documentId,
    );

    if (!matches.length) {
      return { status, citations: [], answer: 'No content was found in this document for that question.' };
    }

    const answer = await this.answer(query, matches, doc?.file_name ?? 'the document');
    return {
      status,
      answer,
      citations: matches.slice(0, 3).map((m) => ({ page: m.page, snippet: m.content.slice(0, 240) })),
    };
  }

  /** Ask the LLM to answer strictly from the retrieved chunks, with citations. */
  private async answer(
    query: string,
    matches: { page: number; content: string }[],
    fileName: string,
  ): Promise<string> {
    const context = matches.map((m, i) => `[${i + 1}] (page ${m.page}) ${m.content}`).join('\n\n');
    const fallback = `From ${fileName}:\n\n${matches
      .map((m) => `• (page ${m.page}) ${m.content.slice(0, 200)}…`)
      .join('\n')}`;

    const provider = this.resolveProvider();
    if (!provider) return fallback;

    const system = [
      `You answer questions about a single procurement document ("${fileName}").`,
      'Use ONLY the numbered context passages below. Cite the page number(s) you used',
      'like "(page 12)". If the answer is not in the passages, say you could not find',
      'it in the document — do not invent anything.',
      '',
      `CONTEXT:\n${context}`,
    ].join('\n');

    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: query },
          ],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`[rag] LLM HTTP ${res.status}`);
        return fallback;
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || fallback;
    } catch (err) {
      this.logger.warn(`[rag] LLM error: ${(err as Error).message}`);
      return fallback;
    }
  }

  private resolveProvider() {
    const groq = process.env.GROQ_API_KEY;
    if (groq)
      return {
        apiKey: groq,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      };
    const openai = process.env.OPENAI_API_KEY;
    if (openai)
      return {
        apiKey: openai,
        url: 'https://api.openai.com/v1/chat/completions',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      };
    return null;
  }
}
