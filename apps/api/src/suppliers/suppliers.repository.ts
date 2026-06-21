import { Injectable } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SupplierCreateInput): Promise<Supplier> {
    return this.prisma.supplier.create({ data });
  }

  findById(id: string) {
    return this.prisma.supplier.findUnique({
      where: { id },
      include: {
        ratings: { orderBy: { createdAt: 'desc' } },
        quotations: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { request: { select: { id: true, title: true } } },
        },
      },
    });
  }

  async findAndCount(params: {
    skip: number;
    take: number;
    search?: string;
  }): Promise<[Supplier[], number]> {
    const where: Prisma.SupplierWhereInput = params.search
      ? {
          OR: [
            { companyName: { contains: params.search, mode: 'insensitive' } },
            { country: { contains: params.search, mode: 'insensitive' } },
            { contactPerson: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {};

    return this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);
  }

  update(id: string, data: Prisma.SupplierUpdateInput): Promise<Supplier> {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  delete(id: string): Promise<Supplier> {
    return this.prisma.supplier.delete({ where: { id } });
  }

  addRating(data: Prisma.SupplierRatingUncheckedCreateInput) {
    return this.prisma.supplierRating.create({ data });
  }

  async avgRating(supplierId: string): Promise<number | null> {
    const result = await this.prisma.supplierRating.aggregate({
      where: { supplierId },
      _avg: { score: true },
    });
    return result._avg.score;
  }
}
