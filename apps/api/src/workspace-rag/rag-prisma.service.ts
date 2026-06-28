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
    super({ datasources: { db: { url: RagPrismaService.directUrl() } } });
  }

  /**
   * Prefer DIRECT_URL; otherwise derive a direct (session) URL from DATABASE_URL
   * by moving off the transaction pooler: port 6543 -> 5432 and dropping the
   * pgbouncer/connection_limit params (which break parameterized raw SQL).
   */
  static directUrl(): string | undefined {
    const direct = process.env.DIRECT_URL;
    if (direct && !/pgbouncer=true/i.test(direct) && !direct.includes(':6543')) {
      return direct;
    }
    const db = process.env.DATABASE_URL;
    if (!db) return direct;
    return db
      .replace(':6543/', ':5432/')
      .replace(/[?&]pgbouncer=true/gi, '')
      .replace(/[?&]connection_limit=\d+/gi, '')
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '');
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(
      `RAG Prisma connected (direct). host port: ${
        RagPrismaService.directUrl()?.match(/:(\d+)\//)?.[1] ?? '?'
      }`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
