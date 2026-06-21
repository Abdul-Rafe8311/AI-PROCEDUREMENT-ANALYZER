import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ComparisonService } from './comparison.service';
import { ChatService } from '../ai/chat.service';

class AskDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question: string;
}

@ApiTags('Comparison & Chat')
@ApiBearerAuth()
@Controller('requests/:requestId')
export class ComparisonController {
  constructor(
    private readonly comparison: ComparisonService,
    private readonly chat: ChatService,
  ) {}

  // Comparison dashboard data (table + risk + recommendation)
  @Get('comparison')
  compare(@Param('requestId') requestId: string) {
    return this.comparison.compare(requestId);
  }

  // AI recommendation (recomputes and returns the comparison's recommendation)
  @Get('recommendation')
  async recommend(@Param('requestId') requestId: string) {
    const result = await this.comparison.compare(requestId);
    return result.recommendation;
  }

  // RAG chat over this request's quotations
  @Post('chat')
  ask(@Param('requestId') requestId: string, @Body() dto: AskDto) {
    return this.chat.ask(requestId, dto.question);
  }
}
