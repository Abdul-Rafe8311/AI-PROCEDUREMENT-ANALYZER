import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
// The quantized model is BUNDLED into the image at build time (see
// scripts/prepare-embedding-model.sh + Dockerfile) so there is ZERO network
// call to huggingface.co at request time. RAG_MODEL_DIR is set in the image;
// process.cwd()/models is the local-dev default.
const MODEL_DIR = resolve(process.env.RAG_MODEL_DIR ?? join(process.cwd(), 'models'));

/**
 * Local sentence embeddings with all-MiniLM-L6-v2 (384-dim, uint8-quantized)
 * via @huggingface/transformers, loaded from files BUNDLED IN THE IMAGE — no
 * runtime download. The model is loaded once, lazily, and reused. Runs
 * in-process on the Render Node backend (no external embedding API).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  static readonly DIM = 384;
  private extractor: unknown | null = null;
  private loading: Promise<unknown> | null = null;

  /** Lazy-load the feature-extraction pipeline from the bundled model (once). */
  private async getExtractor(): Promise<(input: string | string[], opts: object) => Promise<{ tolist(): number[][] }>> {
    if (this.extractor) return this.extractor as never;
    if (!this.loading) {
      this.loading = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        const localPath = join(MODEL_DIR, ...MODEL_ID.split('/'));
        const bundled = existsSync(join(localPath, 'onnx', 'model_quantized.onnx'));
        // Load from local files only. `allowRemoteModels` stays false in
        // production (model is bundled); it's flipped on solely as a local-dev
        // fallback when the model wasn't prepared — and even that degrades
        // gracefully (the caller catches a load failure).
        env.localModelPath = MODEL_DIR;
        env.allowLocalModels = true;
        env.allowRemoteModels = !bundled;
        // Minimize the 512 MB-instance footprint: single ONNX thread.
        try {
          const onnx = (env.backends as Record<string, { numThreads?: number }>).onnx;
          if (onnx) onnx.numThreads = 1;
        } catch {
          /* best-effort */
        }
        this.logger.log(
          bundled
            ? `Loading bundled embedding model (q8) from ${localPath} — no network.`
            : `Bundled model not found at ${localPath}; falling back to remote download (dev only).`,
        );
        const pipe = await pipeline('feature-extraction', MODEL_ID, {
          dtype: 'q8', // 8-bit quantized weights (~4x smaller, much lower RAM)
        });
        this.extractor = pipe;
        this.logger.log('Embedding model ready (q8, 1 thread).');
        return pipe;
      })().catch((err) => {
        // Reset so a later request can retry, and surface a clear reason to the
        // controller (which returns an honest error; comparison chat is fine).
        this.loading = null;
        this.logger.error(`Embedding model failed to load: ${(err as Error).message}`);
        throw new Error(`Embedding model unavailable: ${(err as Error).message}`);
      });
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
