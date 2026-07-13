import { Injectable, Logger } from '@nestjs/common';
import { RagPrismaService } from './rag-prisma.service';
import { EmbeddingService } from './embedding.service';

export interface RetrievedChunk {
  page: number;
  content: string;
  distance: number;
}

export interface SearchResult {
  status: string;
  fileName: string | null;
  /** status/empty message when there's nothing to synthesize */
  message: string | null;
  /** relevance-filtered chunks for the caller (Vercel) to synthesize an answer */
  chunks: RetrievedChunk[];
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private static readonly RETRIEVE = 10; // pull a few extra, then filter
  private static readonly KEEP = 6;
  // Drop chunks much farther than the best hit (clearly off-topic), and a hard
  // absolute cap so weak matches don't pad the context.
  private static readonly REL_MARGIN = 0.18;
  private static readonly ABS_MAX = 0.85;

  constructor(
    private readonly prisma: RagPrismaService,
    private readonly embedder: EmbeddingService,
  ) {}

  async search(documentId: string, query: string): Promise<SearchResult> {
    const docRows = await this.prisma.$queryRawUnsafe<
      { index_status: string | null; file_name: string | null }[]
    >(`select index_status, file_name from documents where id = $1::uuid`, documentId);
    const doc = docRows[0];
    const status = doc?.index_status ?? 'unknown';
    const fileName = doc?.file_name ?? null;

    if (status !== 'ready') {
      return {
        status,
        fileName,
        chunks: [],
        message:
          status === 'indexing' || status === 'pending'
            ? 'This document is still being indexed for deep search. Please try again in a moment.'
            : 'Deep search is not available for this document.',
      };
    }

    // First query after a free-tier spin-down reloads the MiniLM model here — a
    // slow embed is the tell-tale of a cold start (helps correlate failures).
    const embedStart = Date.now();
    const qVec = `[${(await this.embedder.embedOne(query)).join(',')}]`;
    const embedMs = Date.now() - embedStart;
    if (embedMs > 3_000) {
      this.logger.warn(`[rag] slow query embed ${embedMs}ms for ${documentId} — likely a cold start / model reload.`);
    }
    const matches = await this.prisma.$queryRawUnsafe<RetrievedChunk[]>(
      `select page, content, embedding <=> $1::vector as distance
       from document_chunks
       where document_id = $2::uuid
       order by distance asc
       limit ${SearchService.RETRIEVE}`,
      qVec,
      documentId,
    );

    if (!matches.length) {
      return {
        status,
        fileName,
        chunks: [],
        message: 'No relevant content was found in this document for that question.',
      };
    }

    // Relevance filter: keep the best, plus near-equal hits; always keep >=3.
    const best = matches[0].distance;
    const kept = matches.filter(
      (m, i) =>
        i < 3 ||
        (m.distance <= best + SearchService.REL_MARGIN && m.distance <= SearchService.ABS_MAX),
    );
    return { status, fileName, message: null, chunks: kept.slice(0, SearchService.KEEP) };
  }
}
