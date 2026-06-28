import { Injectable, Logger } from '@nestjs/common';
import { RagPrismaService } from './rag-prisma.service';
import { EmbeddingService } from './embedding.service';

// ── Free-tier (512 MB) safety limits ──
// The full NestJS app (~200 MB) + onnxruntime/MiniLM-q8 (~120 MB) already use
// most of 512 MB, so we keep per-batch work tiny and reject large documents up
// front rather than risk an OOM that kills the whole instance.
const MAX_PAGES = 50; // safe limit for deep-search indexing on the free tier
const MAX_CHUNKS = 200;
const BATCH_SIZE = 8; // embed + persist 8 chunks at a time (low peak memory)
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
      `update documents set ${sets.join(', ')} where id = $${n}::uuid`,
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
      `select full_text, index_status, indexed_chunks from documents where id = $1::uuid`,
      documentId,
    );
    const doc = rows[0];
    if (!doc) return this.fail(documentId, 'Document not found.');
    if (doc.index_status === 'ready') return;
    // Permanent rejection (e.g. too large) — don't retry automatically.
    if (doc.index_status === 'failed') {
      const errRows = await this.prisma.$queryRawUnsafe<{ index_error: string | null }[]>(
        `select index_error from documents where id = $1::uuid`,
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

    // 3) Pre-flight memory guard — reject up front, clearly (never attempt it).
    if (pages.length > MAX_PAGES || chunks.length > MAX_CHUNKS) {
      return this.fail(
        documentId,
        `This document is too large to index for deep search on the current plan ` +
          `(${pages.length} pages, safe limit ~${MAX_PAGES} pages). ` +
          `Comparison and extraction are unaffected.`,
      );
    }
    await this.setStatus(documentId, 'indexing', { chunk_count: chunks.length });

    // 4) Resume from the last completed batch.
    const done = await this.prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `select count(*)::int as c from document_chunks where document_id = $1::uuid`,
      documentId,
    );
    let indexed = Number(done[0]?.c ?? 0);

    for (let i = indexed; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      try {
        const vectors = await this.embedder.embed(batch.map((c) => c.content));
        // Retry transient connection drops (the session pooler can close an idle
        // connection during the one-time model download); Prisma reconnects.
        await this.withRetry(() => this.persistBatch(documentId, batch, vectors));
        indexed += batch.length;
        await this.withRetry(() =>
          this.setStatus(documentId, 'indexing', { indexed_chunks: indexed }),
        );
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

  /** Insert a whole batch in ONE multi-row statement (idempotent upsert). */
  private async persistBatch(documentId: string, batch: Chunk[], vectors: number[][]): Promise<void> {
    if (!batch.length) return;
    const params: unknown[] = [];
    const tuples = batch.map((c, j) => {
      const base = j * 5;
      params.push(documentId, c.index, c.page, c.content, `[${(vectors[j] ?? []).join(',')}]`);
      return `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`;
    });
    await this.prisma.$executeRawUnsafe(
      `insert into document_chunks (document_id, chunk_index, page, content, embedding)
       values ${tuples.join(', ')}
       on conflict (document_id, chunk_index) do nothing`,
      ...params,
    );
  }

  /** Retry a DB op on transient connection errors (pooler dropping idle conns). */
  private async withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message ?? '';
        const transient = /reach database server|connection|closed|terminat|ECONNRESET|timed out/i.test(msg);
        if (!transient || attempt === tries) break;
        this.logger.warn(`[rag] transient DB error (attempt ${attempt}/${tries}); retrying…`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastErr;
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
