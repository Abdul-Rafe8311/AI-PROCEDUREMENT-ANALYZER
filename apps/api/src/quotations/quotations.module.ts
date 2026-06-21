import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsRepository } from './quotations.repository';
import { QuotationsController } from './quotations.controller';

@Module({
  providers: [QuotationsService, QuotationsRepository],
  controllers: [QuotationsController],
  exports: [QuotationsService, QuotationsRepository],
})
export class QuotationsModule {}
