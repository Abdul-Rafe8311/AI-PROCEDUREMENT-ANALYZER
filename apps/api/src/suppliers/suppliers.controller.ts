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
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierDto,
  RateSupplierDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

@ApiTags('Suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.suppliersService.create(dto, user.id);
  }

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.suppliersService.history(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.suppliersService.update(id, dto, user.id);
  }

  @Post(':id/ratings')
  rate(
    @Param('id') id: string,
    @Body() dto: RateSupplierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.suppliersService.rate(id, dto, user.id);
  }

  // Only admins can permanently delete suppliers.
  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.suppliersService.remove(id, user.id);
  }
}
