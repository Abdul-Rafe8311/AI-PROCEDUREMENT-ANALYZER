import { Module } from '@nestjs/common';
import { ComparisonService } from './comparison.service';
import { ComparisonController } from './comparison.controller';

@Module({
  providers: [ComparisonService],
  controllers: [ComparisonController],
  exports: [ComparisonService],
})
export class ComparisonModule {}
