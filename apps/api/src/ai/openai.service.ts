import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Central OpenAI wrapper. Degrades gracefully when no API key is configured
 * so the rest of the app (uploads, comparison, rule-based risk) still works.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(private readonly config: ConfigService) {
    const cfg = this.config.get('openai');
    this.model = cfg.model;
    this.embeddingModel = cfg.embeddingModel;
    this.client = cfg.apiKey
      ? new OpenAI({ apiKey: cfg.apiKey })
      : null;
    if (!this.client) {
      this.logger.warn(
        'OPENAI_API_KEY not set — AI features fall back to heuristic logic.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  /** Chat completion returning plain text. */
  async complete(
    system: string,
    user: string,
    opts: { temperature?: number; maxTokens?: number } = {},
  ): Promise<string> {
    if (!this.client) return '';
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /** Chat completion that enforces a JSON object response. */
  async completeJson<T = any>(system: string, user: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const content = res.choices[0]?.message?.content;
      return content ? (JSON.parse(content) as T) : null;
    } catch (err) {
      this.logger.error(`JSON completion failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Returns embedding vectors for a batch of texts. */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.client || texts.length === 0) return [];
    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });
    return res.data.map((d) => d.embedding as number[]);
  }
}
