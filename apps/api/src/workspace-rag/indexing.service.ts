import { Injectable, Logger } from '@nestjs/common';
import { RagPrismaService } from './rag-prisma.service';
import { EmbeddingService } from './embedding.service';

// ── Free-tier (512 MB) safety limits ──
// A document larger than this is rejected up front instead of risking an OOM.
const MAX_PAGES = 60;
const MAX_CHUNKS = 300;
const BATCH_SIZE = 50; // embed + persist this many chunks at a time
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;

export interface PageText {
  page: number;
  text: string;
}

export interface Chunk {
  index: number;
  page: number;
  content: string;
}

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);
  // Guards against concurrent indexing of the same document in one process.
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: RagPrismaService,
    private readonly embedder: EmbeddingService,
  ) {}

  /** Kick off background indexing; returns immediately (never blocks HTTP). */
  start(documentId: string, fileUrl: string): void {
    if (this.inFlight.has(documentId)) return;
    this.inFlight.add(documentId);
    // Fire-and-forget — status is tracked in the DB and polled by the client.
    void this.run(documentId, fileUrl)
      .catch((err) => this.fail(documentId, `Indexing crashed: ${(err as Error).message}`))
      .finally(() => this.inFlight.delete(documentId));
  }

  private async setStatus(
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const sets = ['index_status = $1'];
    const vals: unknown[] = [status];
    let n = 2;
    for (const [k, v] of Object.entries(extra)) {
      sets.push(`${k} = $${n++}`);
      vals.push(v);
    }
    vals.push(id);
    await this.prisma.$executeRawUnsafe(
      `update documents set ${sets.join(', ')} where id = $${n}`,
      ...vals,
    );
  }

  private async fail(id: string, message: string): Promise<void> {
    this.logger.warn(`[rag] ${id}: ${message}`);
    await this.setStatus(id, 'failed', { index_error: message }).catch(() => undefined);
  }

  /** Main pipeline: parse → guard → batched, resumable embed+store. */
  private async run(documentId: string, fileUrl: string): Promise<void> {
    this.logger.log(`[rag] start indexing ${documentId} (${fileUrl})`);
    const rows = await this.prisma.$queryRawUnsafe<
      { full_text: string | null; index_status: string | null; indexed_chunks: number | null }[]
    >(
      `select full_text, index_status, indexed_chunks from documents where id = $1`,
      documentId,
    );
    const doc = rows[0];
    if (!doc) return this.fail(documentId, 'Document not found.');
    if (doc.index_status === 'ready') return;
    // Permanent rejection (e.g. too large) — don't retry automatically.
    if (doc.index_status === 'failed') {
      const errRows = await this.prisma.$queryRawUnsafe<{ index_error: string | null }[]>(
        `select index_error from documents where id = $1`,
        documentId,
      );
      if (/too large/i.test(errRows[0]?.index_error ?? '')) return;
    }

    await this.setStatus(documentId, 'indexing', { index_error: null });

    // 1) Get full text (reuse stored text so restarts don't re-download/parse).
    let pages: PageText[];
    if (doc.full_text) {
      pages = JSON.parse(doc.full_text) as PageText[];
    } else {
      try {
        pages = await this.parse(fileUrl);
      } catch (err) {
        return this.fail(documentId, `Could not parse document: ${(err as Error).message}`);
      }
      await this.setStatus(documentId, 'indexing', { full_text: JSON.stringify(pages) });
    }

    // 2) Build chunks deterministically (same input → same chunk_index).
    const chunks = this.chunk(pages);

    // 3) Pre-flight memory guard — reject up front, clearly.
    if (pages.length > MAX_PAGES || chunks.length > MAX_CHUNKS) {
      return this.fail(
        documentId,
        `Document too large to index on the current plan (${pages.length} pages). ` +
          `Try a smaller file, or contact us to enable large-document support.`,
      );
    }
    await this.setStatus(documentId, 'indexing', { chunk_count: chunks.length });

    // 4) Resume from the last completed batch.
    const done = await this.prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `select count(*)::int as c from document_chunks where document_id = $1`,
      documentId,
    );
    let indexed = Number(done[0]?.c ?? 0);

    for (let i = indexed; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      try {
        const vectors = await this.embedder.embed(batch.map((c) => c.content));
        await this.persistBatch(documentId, batch, vectors);
        indexed += batch.length;
        await this.setStatus(documentId, 'indexing', { indexed_chunks: indexed });
      } catch (err) {
        // Leave status 'indexing' + progress saved so a later call resumes here.
        return this.fail(
          documentId,
          `Indexing failed at chunk ${i}/${chunks.length}: ${(err as Error).message}. ` +
            `Will resume from chunk ${indexed} on retry.`,
        );
      }
    }

    await this.setStatus(documentId, 'ready', { indexed_chunks: indexed });
    this.logger.log(`[rag] ${documentId}: indexed ${indexed} chunks (ready).`);
  }

  /** Insert a batch of chunks with their vectors (idempotent upsert). */
  private async persistBatch(documentId: string, batch: Chunk[], vectors: number[][]): Promise<void> {
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const vec = `[${(vectors[j] ?? []).join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `insert into document_chunks (document_id, chunk_index, page, content, embedding)
         values ($1, $2, $3, $4, $5::vector)
         on conflict (document_id, chunk_index) do nothing`,
        documentId,
        c.index,
        c.page,
        c.content,
        vec,
      );
    }
  }

  /** Download + parse a PDF into per-page text (for page citations). */
  private async parse(fileUrl: string): Promise<PageText[]> {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const pages: PageText[] = [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse');
    await pdfParse(buffer, {
      // Collect each page's text so chunks can carry a page number.
      pagerender: (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) =>
        pageData.getTextContent().then((tc) => {
          const text = tc.items.map((it) => it.str).join(' ');
          pages.push({ page: pages.length + 1, text });
          return text;
        }),
    });
    return pages.filter((p) => p.text.trim().length > 0);
  }

  /** Overlapping chunks, page-aware. */
  private chunk(pages: PageText[]): Chunk[] {
    const chunks: Chunk[] = [];
    let index = 0;
    for (const { page, text } of pages) {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      if (clean.length <= CHUNK_SIZE) {
        chunks.push({ index: index++, page, content: clean });
        continue;
      }
      for (let i = 0; i < clean.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        const slice = clean.slice(i, i + CHUNK_SIZE).trim();
        if (slice) chunks.push({ index: index++, page, content: slice });
      }
    }
    return chunks;
  }
}
