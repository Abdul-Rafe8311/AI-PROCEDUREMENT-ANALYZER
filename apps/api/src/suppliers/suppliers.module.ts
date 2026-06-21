import { Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersRepository } from './suppliers.repository';
import { SuppliersController } from './suppliers.controller';

@Module({
  providers: [SuppliersService, SuppliersRepository],
  controllers: [SuppliersController],
  exports: [SuppliersService, SuppliersRepository],
})
export class SuppliersModule {}
