import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { SuppliersRepository } from './suppliers.repository';
import {
  CreateSupplierDto,
  RateSupplierDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly repo: SuppliersRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSupplierDto, userId: string) {
    const supplier = await this.repo.create({
      ...dto,
      reliabilityScore: dto.reliabilityScore ?? 50,
      createdBy: { connect: { id: userId } },
    });
    await this.audit.log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'Supplier',
      entityId: supplier.id,
      metadata: { companyName: supplier.companyName },
    });
    return supplier;
  }

  async findAll(query: PaginationDto) {
    const [data, total] = await this.repo.findAndCount({
      skip: query.skip,
      take: query.limit,
      search: query.search,
    });
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const supplier = await this.repo.findById(id);
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, userId: string) {
    await this.findOne(id);
    const supplier = await this.repo.update(id, dto);
    await this.audit.log({
      userId,
      action: AuditAction.UPDATE,
      entityType: 'Supplier',
      entityId: id,
    });
    return supplier;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.repo.delete(id);
    await this.audit.log({
      userId,
      action: AuditAction.DELETE,
      entityType: 'Supplier',
      entityId: id,
    });
    return { success: true };
  }

  /** Adds a 1-5 rating and recomputes the reliability score (0-100). */
  async rate(id: string, dto: RateSupplierDto, userId: string) {
    await this.findOne(id);
    await this.repo.addRating({
      supplierId: id,
      score: dto.score,
      comment: dto.comment,
      createdById: userId,
    });
    const avg = await this.repo.avgRating(id);
    // Map 1-5 star average to a 0-100 reliability score
    const reliabilityScore = avg ? Math.round((avg / 5) * 100) : 50;
    const supplier = await this.repo.update(id, { reliabilityScore });
    await this.audit.log({
      userId,
      action: AuditAction.UPDATE,
      entityType: 'Supplier',
      entityId: id,
      metadata: { event: 'rating', score: dto.score, reliabilityScore },
    });
    return supplier;
  }

  /** Supplier history: ratings + quotation participation. */
  async history(id: string) {
    const supplier = await this.findOne(id);
    return {
      supplierId: supplier.id,
      companyName: supplier.companyName,
      reliabilityScore: supplier.reliabilityScore,
      ratings: (supplier as any).ratings ?? [],
      quotations: (supplier as any).quotations ?? [],
    };
  }
}
