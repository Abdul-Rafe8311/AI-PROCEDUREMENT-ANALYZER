import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { IndexingService } from './indexing.service';
import { RagPrismaService } from './rag-prisma.service';
import { SearchService } from './search.service';
import { WorkspaceRagController } from './workspace-rag.controller';

// Anonymous deep-document RAG for /workspace: MiniLM embeddings + pgvector,
// background batched/resumable indexing, runs on the Render (Docker) backend.
// Uses its own direct-connection Prisma client (pooler hangs on raw vector SQL).
@Module({
  controllers: [WorkspaceRagController],
  providers: [EmbeddingService, IndexingService, SearchService, RagPrismaService],
})
export class WorkspaceRagModule {}
