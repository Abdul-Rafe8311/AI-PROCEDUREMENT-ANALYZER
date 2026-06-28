import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Dedicated Prisma client for RAG raw SQL (incl. pgvector). Uses the DIRECT
 * (session) connection — DIRECT_URL — instead of the transaction pooler, which
 * hangs/fails on parameterized $queryRawUnsafe. Low-concurrency RAG only.
 */
@Injectable()
export class RagPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagPrismaService.name);

  constructor() {
    super({
      datasources: {
        db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('RAG Prisma connected via direct connection.');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
