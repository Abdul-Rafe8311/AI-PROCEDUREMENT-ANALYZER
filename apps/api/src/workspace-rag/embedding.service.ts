import { Injectable, Logger } from '@nestjs/common';

/**
 * Local sentence embeddings with all-MiniLM-L6-v2 (384-dim) via
 * @huggingface/transformers. The model is loaded once, lazily, and reused.
 * Runs in-process on the Render Node backend (no external embedding API).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  static readonly DIM = 384;
  private extractor: unknown | null = null;
  private loading: Promise<unknown> | null = null;

  /** Lazy-load the feature-extraction pipeline (downloads the model once). */
  private async getExtractor(): Promise<(input: string | string[], opts: object) => Promise<{ tolist(): number[][] }>> {
    if (this.extractor) return this.extractor as never;
    if (!this.loading) {
      this.loading = (async () => {
        this.logger.log('Loading all-MiniLM-L6-v2 embedding model…');
        const { pipeline } = await import('@huggingface/transformers');
        const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        this.extractor = pipe;
        this.logger.log('Embedding model ready.');
        return pipe;
      })();
    }
    return (await this.loading) as never;
  }

  /** Embed a batch of texts → array of 384-dim unit vectors (mean-pooled). */
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }

  /** Convenience: embed a single string. */
  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    return v ?? [];
  }
}
