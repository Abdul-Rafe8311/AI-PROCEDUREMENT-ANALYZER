import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('requests/:requestId/reports')
  generate(@Param('requestId') requestId: string, @CurrentUser() user: AuthUser) {
    return this.reports.generate(requestId, { id: user.id, name: user.email });
  }

  @Get('requests/:requestId/reports')
  list(@Param('requestId') requestId: string) {
    return this.reports.findByRequest(requestId);
  }

  @Get('reports/:id/download')
  download(@Param('id') id: string) {
    return this.reports.download(id);
  }
}
