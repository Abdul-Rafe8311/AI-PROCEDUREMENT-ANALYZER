// Server-only Anthropic (Claude) client for the two written-answer LLM paths:
// comparison chat (/api/chat) and deep-document RAG synthesis (/api/doc-answer).
//
// Extraction deliberately stays on Groq for now (see extraction-server.ts). The
// model is env-configurable so extraction can later move to a cheaper Claude
// model via ANTHROPIC_EXTRACTION_MODEL without touching this chat/answer path.

import Anthropic from '@anthropic-ai/sdk';
import { CHART_METRICS, type ChartDirective, type ChartMetric } from './workspace-types';

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

// ── Chat with optional chart (Claude tool use) ──
// The model may call show_chart to VISUALIZE a comparison. It only picks a
// metric — the app renders the chart from real analysis data (never invented).
const SHOW_CHART_TOOL: Anthropic.Tool = {
  name: 'show_chart',
  description:
    'Display a chart in the chat to help the buyer VISUALIZE a comparison. Call this ONLY when the user asks to see, visualize, plot, graph, or chart something, or clearly wants a visual comparison. Pick the SINGLE metric that best answers the question. The app renders the chart from the real analysis data — do NOT provide any numbers or data points.',
  input_schema: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        enum: [...CHART_METRICS],
        description:
          'cost = total cost per supplier (USD); score = overall procurement score 0-100; delivery = delivery time in days; material = per-item unit prices across suppliers',
      },
      title: { type: 'string', description: 'Optional short chart title, e.g. "Total cost by supplier".' },
    },
    required: ['metric'],
  },
};

/**
 * Answer a comparison question, optionally returning a data-free chart directive
 * when the model decides a visual helps. Uses one tool round-trip: if the model
 * calls show_chart, we return the tool result so it can finish its text answer.
 * Throws MissingAnthropicKeyError when the key is unset.
 */
export async function answerWithClaudeChart(opts: {
  system: string;
  messages: ClaudeTurn[];
  maxTokens?: number;
}): Promise<{ answer: string; chart: ChartDirective | null }> {
  const anthropic = getClient();
  const maxTokens = opts.maxTokens ?? 1024;
  const baseMessages: Anthropic.MessageParam[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));

  const textOf = (blocks: Anthropic.ContentBlock[]) =>
    blocks
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

  const first = await anthropic.messages.create({
    model: CHAT_MODEL,
    max_tokens: maxTokens,
    system: opts.system,
    messages: baseMessages,
    tools: [SHOW_CHART_TOOL],
  });

  const toolUse = first.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (first.stop_reason !== 'tool_use' || !toolUse) {
    return { answer: textOf(first.content), chart: null };
  }

  const input = (toolUse.input ?? {}) as { metric?: string; title?: string };
  const chart: ChartDirective | null =
    input.metric && (CHART_METRICS as readonly string[]).includes(input.metric)
      ? { metric: input.metric as ChartMetric, ...(input.title ? { title: input.title } : {}) }
      : null;

  // Feed the tool result back (no tools this turn) so the model writes its text.
  const second = await anthropic.messages.create({
    model: CHAT_MODEL,
    max_tokens: maxTokens,
    system: opts.system,
    messages: [
      ...baseMessages,
      { role: 'assistant', content: first.content as unknown as Anthropic.ContentBlockParam[] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: chart ? `The ${chart.metric} chart is now shown to the user.` : 'No chart could be shown.',
          },
        ],
      },
    ],
  });

  const answer = textOf(second.content) || textOf(first.content) || 'Here is the chart you asked for.';
  return { answer, chart };
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
