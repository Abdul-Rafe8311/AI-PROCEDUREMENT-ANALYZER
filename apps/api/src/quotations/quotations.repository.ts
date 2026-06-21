import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuotationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.QuotationUncheckedCreateInput) {
    return this.prisma.quotation.create({ data });
  }

  findById(id: string) {
    return this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true, supplier: true, request: true },
    });
  }

  findByRequest(requestId: string) {
    return this.prisma.quotation.findMany({
      where: { requestId },
      include: { items: true, supplier: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  update(id: string, data: Prisma.QuotationUncheckedUpdateInput) {
    return this.prisma.quotation.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.quotation.delete({ where: { id } });
  }

  replaceItems(quotationId: string, items: Prisma.QuotationItemCreateManyInput[]) {
    return this.prisma.$transaction([
      this.prisma.quotationItem.deleteMany({ where: { quotationId } }),
      this.prisma.quotationItem.createMany({ data: items }),
    ]);
  }

  findSupplierByName(name: string) {
    return this.prisma.supplier.findFirst({
      where: { companyName: { equals: name, mode: 'insensitive' } },
    });
  }
}
