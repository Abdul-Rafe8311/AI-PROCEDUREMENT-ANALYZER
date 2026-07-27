// One call, either provider — the seam the document router routes through.
//
// Both branches return the SAME shape, `{ content: string }`, so every caller
// downstream (quotation extraction, the tender-sheet fill, and therefore scoring,
// the TA form renderer and the Excel export) is unchanged by which model ran.
// That is the whole point: the provider is a routing decision, not a behavioural
// one.
//
// Server-only: both branches read an API key from the environment, so this must
// never be imported into a client component.

import { extractJsonWithClaude } from './anthropic';
import type { LlmProvider } from './document-router';

export interface LlmRequest {
  system: string;
  user: string;
  /** cap on the reply; the JSON schemas here are large, so this is generous */
  maxTokens?: number;
}

export interface LlmReply {
  content: string;
}

/** Thrown when the chosen provider has no key configured — callers degrade. */
export class MissingProviderKeyError extends Error {
  constructor(public readonly provider: LlmProvider) {
    super(
      provider === 'groq'
        ? 'GROQ_API_KEY is not configured.'
        : 'ANTHROPIC_API_KEY is not configured.',
    );
    this.name = 'MissingProviderKeyError';
  }
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const groqModel = () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export const isGroqConfigured = (): boolean => !!process.env.GROQ_API_KEY;

/**
 * Run one structured-extraction request against the given provider.
 *
 * Claude delegates to the existing helper, untouched — its vision and
 * translation paths are not reachable from here and are unaffected.
 */
export async function callLLM(req: LlmRequest, provider: LlmProvider): Promise<LlmReply> {
  if (provider === 'groq') return callGroq(req);
  const { content } = await extractJsonWithClaude({
    system: req.system,
    user: req.user,
    ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}),
  });
  return { content };
}

async function callGroq(req: LlmRequest): Promise<LlmReply> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new MissingProviderKeyError('groq');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: groqModel(),
      // Deterministic, like the Claude path — an extraction must not vary run to run.
      temperature: 0,
      max_tokens: req.maxTokens ?? 8192,
      // Ask for JSON explicitly; Groq honours this and it materially reduces the
      // prose-wrapped replies the callers' loose parsers otherwise have to strip.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status} (model "${groqModel()}"): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { content: json.choices?.[0]?.message?.content ?? '' };
}
