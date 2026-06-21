import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Role, RequestStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { ProcurementRepository } from './procurement.repository';
import {
  CreateProcurementRequestDto,
  UpdateProcurementRequestDto,
} from './dto/procurement.dto';

@Injectable()
export class ProcurementService {
  constructor(
    private readonly repo: ProcurementRepository,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateProcurementRequestDto, userId: string) {
    const request = await this.repo.create({
      title: dto.title,
      description: dto.description,
      requiredItems: dto.requiredItems,
      quantity: dto.quantity,
      requiredDeliveryDate: dto.requiredDeliveryDate
        ? new Date(dto.requiredDeliveryDate)
        : null,
      budget: dto.budget,
      currency: dto.currency ?? 'USD',
      ownerId: userId,
    });
    await this.audit.log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'ProcurementRequest',
      entityId: request.id,
      metadata: { title: request.title },
    });
    return request;
  }

  async findAll(query: PaginationDto, user: { id: string; role: Role }) {
    // Managers see their own requests; admins see all.
    const ownerId = user.role === Role.ADMIN ? undefined : user.id;
    const [data, total] = await this.repo.findAndCount({
      skip: query.skip,
      take: query.limit,
      search: query.search,
      ownerId,
    });
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, user?: { id: string; role: Role }) {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundException('Procurement request not found');
    this.assertAccess(request.ownerId, user);
    return request;
  }

  async update(
    id: string,
    dto: UpdateProcurementRequestDto,
    user: { id: string; role: Role },
  ) {
    const existing = await this.findOne(id, user);
    const request = await this.repo.update(id, {
      ...dto,
      requiredDeliveryDate: dto.requiredDeliveryDate
        ? new Date(dto.requiredDeliveryDate)
        : undefined,
    });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      entityType: 'ProcurementRequest',
      entityId: id,
    });
    return request;
  }

  async remove(id: string, user: { id: string; role: Role }) {
    await this.findOne(id, user);
    await this.repo.delete(id);
    await this.audit.log({
      userId: user.id,
      action: AuditAction.DELETE,
      entityType: 'ProcurementRequest',
      entityId: id,
    });
    return { success: true };
  }

  /** Awards a request to a quotation and closes it. */
  async award(
    id: string,
    quotationId: string,
    user: { id: string; role: Role },
  ) {
    const request = await this.findOne(id, user);
    const quotation = request.quotations.find((q) => q.id === quotationId);
    if (!quotation) {
      throw new NotFoundException('Quotation does not belong to this request');
    }
    const updated = await this.repo.update(id, {
      awardedQuotationId: quotationId,
      status: RequestStatus.AWARDED,
    });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.AWARD,
      entityType: 'ProcurementRequest',
      entityId: id,
      metadata: { quotationId },
    });
    return updated;
  }

  private assertAccess(ownerId: string, user?: { id: string; role: Role }) {
    if (!user) return;
    if (user.role !== Role.ADMIN && ownerId !== user.id) {
      throw new ForbiddenException('You do not have access to this request');
    }
  }
}
