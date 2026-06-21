import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ProcurementService } from './procurement.service';
import {
  CreateProcurementRequestDto,
  UpdateProcurementRequestDto,
} from './dto/procurement.dto';

@ApiTags('Procurement Requests')
@ApiBearerAuth()
@Controller('requests')
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  private ctx(user: AuthUser) {
    return { id: user.id, role: user.role as Role };
  }

  @Post()
  create(@Body() dto: CreateProcurementRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  findAll(@Query() query: PaginationDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, this.ctx(user));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, this.ctx(user));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProcurementRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, this.ctx(user));
  }

  @Post(':id/award/:quotationId')
  award(
    @Param('id') id: string,
    @Param('quotationId') quotationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.award(id, quotationId, this.ctx(user));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, this.ctx(user));
  }
}
