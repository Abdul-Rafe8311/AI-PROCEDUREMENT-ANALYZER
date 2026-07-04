// Server-only Anthropic (Claude) client for the two written-answer LLM paths:
// comparison chat (/api/chat) and deep-document RAG synthesis (/api/doc-answer).
//
// Extraction deliberately stays on Groq for now (see extraction-server.ts). The
// model is env-configurable so extraction can later move to a cheaper Claude
// model via ANTHROPIC_EXTRACTION_MODEL without touching this chat/answer path.

import Anthropic from '@anthropic-ai/sdk';

/** Thrown when ANTHROPIC_API_KEY is not configured — callers degrade gracefully. */
export class MissingAnthropicKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not configured.');
    this.name = 'MissingAnthropicKeyError';
  }
}

/** Model for chat + deep-document answers. Override with ANTHROPIC_CHAT_MODEL. */
export const CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-6';

/** Model for scanned-PDF vision extraction. Override with ANTHROPIC_VISION_MODEL. */
export const VISION_MODEL = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-6';

/** True when a Claude key is present — lets routes report a clear degraded state. */
export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingAnthropicKeyError();
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export interface ClaudeTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** A scanned PDF (sent as a document block) or a photo/screenshot (image block). */
export type VisionMedia =
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; base64: string; mediaType: ImageMediaType };

/**
 * Vision extraction from a scanned PDF or an image. The PDF is sent as a
 * `document` block (Claude rasterizes each page server-side and reads it with
 * vision); an image is sent as an `image` block directly — no local conversion.
 * Returns the raw text response (expected to be JSON). Throws
 * MissingAnthropicKeyError when the key is unset, or the SDK's API errors on
 * failure — the caller decides how to degrade (never sample data).
 */
export async function extractJsonFromMedia(opts: {
  system: string;
  instruction: string;
  media: VisionMedia;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const anthropic = getClient();
  const mediaBlock: Anthropic.ContentBlockParam =
    opts.media.kind === 'pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: opts.media.base64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: opts.media.mediaType, data: opts.media.base64 },
        };
  const content: Anthropic.ContentBlockParam[] = [
    mediaBlock,
    { type: 'text', text: opts.instruction },
  ];
  const res = await anthropic.messages.create({
    model: opts.model || VISION_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: [{ role: 'user', content }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Single-call answer synthesis with Claude. Returns the plain-text answer.
 * Throws MissingAnthropicKeyError when the key is unset, or the SDK's typed API
 * errors on failure — the caller decides how to degrade (never sample data).
 */
export async function answerWithClaude(opts: {
  system: string;
  messages: ClaudeTurn[];
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: opts.model || CHAT_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
