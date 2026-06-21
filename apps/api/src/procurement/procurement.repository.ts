import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProcurementRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProcurementRequestUncheckedCreateInput) {
    return this.prisma.procurementRequest.create({ data });
  }

  findById(id: string) {
    return this.prisma.procurementRequest.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        quotations: {
          include: { supplier: true, items: true },
          orderBy: { createdAt: 'asc' },
        },
        recommendation: true,
        reports: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async findAndCount(params: {
    skip: number;
    take: number;
    search?: string;
    ownerId?: string;
  }): Promise<[any[], number]> {
    const where: Prisma.ProcurementRequestWhereInput = {
      ...(params.ownerId ? { ownerId: params.ownerId } : {}),
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: 'insensitive' } },
              { description: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prisma.$transaction([
      this.prisma.procurementRequest.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { quotations: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.procurementRequest.count({ where }),
    ]);
  }

  update(id: string, data: Prisma.ProcurementRequestUncheckedUpdateInput) {
    return this.prisma.procurementRequest.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.procurementRequest.delete({ where: { id } });
  }
}
