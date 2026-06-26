import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingService } from './embedding.service';
import { IndexingService } from './indexing.service';
import { SearchService } from './search.service';
import { WorkspaceRagController } from './workspace-rag.controller';

// Anonymous deep-document RAG for /workspace: MiniLM embeddings + pgvector,
// background batched/resumable indexing, runs on the Render (Docker) backend.
@Module({
  imports: [PrismaModule],
  controllers: [WorkspaceRagController],
  providers: [EmbeddingService, IndexingService, SearchService],
})
export class WorkspaceRagModule {}
