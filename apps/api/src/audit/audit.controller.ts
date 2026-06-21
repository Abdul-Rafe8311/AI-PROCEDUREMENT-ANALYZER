import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Audit trail is admin-only.
  @Get()
  @Roles(Role.ADMIN)
  findAll(@Query('limit') limit?: string) {
    return this.auditService.findAll(limit ? parseInt(limit, 10) : 100);
  }
}
