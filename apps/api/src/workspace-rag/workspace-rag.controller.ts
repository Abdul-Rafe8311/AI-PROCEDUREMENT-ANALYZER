import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { RagPrismaService } from './rag-prisma.service';
import { IndexingService } from './indexing.service';
import { SearchService } from './search.service';

// Anonymous endpoints for the no-login /workspace deep-document search.
@ApiTags('Workspace RAG')
@Public()
@Controller('public/rag')
export class WorkspaceRagController {
  constructor(
    private readonly prisma: RagPrismaService,
    private readonly indexing: IndexingService,
    private readonly search: SearchService,
  ) {}

  // Start background indexing for a document; returns immediately.
  @Post('index')
  @HttpCode(202)
  async index(@Body() body: { documentId?: string; fileUrl?: string }) {
    const { documentId, fileUrl } = body ?? {};
    if (!documentId || !fileUrl) {
      return { ok: false, error: 'documentId and fileUrl are required.' };
    }
    this.indexing.start(documentId, fileUrl);
    return { ok: true, status: 'indexing' };
  }

  // Poll index status for one or more documents (comma-separated ids).
  @Get('status')
  async status(@Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return { documents: [] };
    // Cast each param to uuid — Postgres binds string params as text, and
    // `uuid = text` has no operator (fails with a generic DB error otherwise).
    const placeholders = list.map((_, i) => `$${i + 1}::uuid`).join(', ');
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        index_status: string | null;
        index_error: string | null;
        chunk_count: number | null;
        indexed_chunks: number | null;
      }[]
    >(
      `select id, index_status, index_error, chunk_count, indexed_chunks
       from documents where id in (${placeholders})`,
      ...list,
    );
    return {
      documents: rows.map((r) => ({
        documentId: r.id,
        status: r.index_status ?? 'pending',
        error: r.index_error,
        chunkCount: r.chunk_count ?? 0,
        indexedChunks: r.indexed_chunks ?? 0,
      })),
    };
  }

  // Deep-document question over a single document's indexed chunks.
  @Post('search')
  async query(@Body() body: { documentId?: string; query?: string }) {
    const { documentId, query } = body ?? {};
    if (!documentId || !query?.trim()) {
      return { answer: 'documentId and query are required.', citations: [], status: 'error' };
    }
    return this.search.search(documentId, query);
  }
}
