import { Module } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { ProcurementRepository } from './procurement.repository';
import { ProcurementController } from './procurement.controller';

@Module({
  providers: [ProcurementService, ProcurementRepository],
  controllers: [ProcurementController],
  exports: [ProcurementService, ProcurementRepository],
})
export class ProcurementModule {}
