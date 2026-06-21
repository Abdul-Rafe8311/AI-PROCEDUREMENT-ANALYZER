import { Global, Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { DocumentParserService } from './document-parser.service';
import { ExtractionService } from './extraction.service';
import { RiskService } from './risk.service';
import { RecommendationService } from './recommendation.service';
import { ChatService } from './chat.service';

@Global()
@Module({
  providers: [
    OpenAiService,
    DocumentParserService,
    ExtractionService,
    RiskService,
    RecommendationService,
    ChatService,
  ],
  exports: [
    OpenAiService,
    DocumentParserService,
    ExtractionService,
    RiskService,
    RecommendationService,
    ChatService,
  ],
})
export class AiModule {}
