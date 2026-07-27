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

// ── TEMPORARY DIAGNOSTIC LOGGING ────────────────────────────────────────────
// Added to find out what Groq actually returns for a document that extracts as
// empty. Logs the raw reply BEFORE any parser touches it, the exact throw, and
// what looseJsonParse then makes of it. Remove once the cause is found.
const dlog = (...a: unknown[]) => console.error('[llm-provider]', ...a);

/** Same loose parse the callers use, run here ONLY to log what it yields. */
function diagnosticParse(content: string): { ok: boolean; detail: string } {
  const raw = String(content ?? '').trim();
  const body = /```/.test(raw) ? raw.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/```[\s\S]*$/, '') : raw;
  const start = body.search(/[{[]/);
  if (start < 0) return { ok: false, detail: 'no { or [ anywhere in the reply' };
  try {
    const v = JSON.parse(body.slice(start)) as Record<string, unknown>;
    const keys = v && typeof v === 'object' ? Object.keys(v) : [];
    const suppliers = (v as { suppliers?: unknown[] })?.suppliers;
    return {
      ok: true,
      detail:
        `parsed OK — top-level keys: [${keys.join(', ')}]` +
        (Array.isArray(suppliers)
          ? `; suppliers: ${suppliers.length}`
          : `; NO "suppliers" array (this is what makes the extraction empty)`),
    };
  } catch (err) {
    return { ok: false, detail: `JSON.parse threw: ${(err as Error).message}` };
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
  if (provider === 'groq') {
    dlog(`CALL groq — system ${req.system.length} chars, user ${req.user.length} chars`);
    try {
      return await callGroq(req);
    } catch (err) {
      // (2) anything the call throws, including network/DNS/abort — logged with a
      // stack before it propagates, so nothing is lost to a caller's catch.
      dlog(`GROQ THREW: ${(err as Error).name}: ${(err as Error).message}`);
      dlog((err as Error).stack ?? '(no stack)');
      throw err;
    }
  }
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
    // (2) the exact failure, verbatim and untruncated — an auth or model-name
    // error reads very differently from a rate limit or a context-length reject.
    dlog(`GROQ HTTP ${res.status} ${res.statusText} — model "${groqModel()}"`);
    dlog(`GROQ ERROR BODY: ${body}`);
    throw new Error(`Groq HTTP ${res.status} (model "${groqModel()}"): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: Record<string, number>;
  };
  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? '';

  // (1) the raw reply, before any parser sees it.
  dlog(`GROQ OK — model "${groqModel()}" finish_reason=${choice?.finish_reason ?? '?'} usage=${JSON.stringify(json.usage ?? {})}`);
  dlog(`GROQ RAW CONTENT (${content.length} chars):\n${content}`);
  if (!content) dlog('GROQ RETURNED EMPTY CONTENT — choices[0] was: ' + JSON.stringify(choice ?? null).slice(0, 500));
  // finish_reason "length" means the reply was CUT OFF mid-JSON by max_tokens,
  // which produces valid-looking text that no parser can complete.
  if (choice?.finish_reason === 'length') {
    dlog(`GROQ TRUNCATED: hit max_tokens (${req.maxTokens ?? 8192}) — the JSON is incomplete.`);
  }

  // (3) what the callers' loose parse makes of it. Logged only; nothing branches
  // on this, so parsing behaviour is unchanged.
  const parsed = diagnosticParse(content);
  dlog(`GROQ PARSE CHECK: ${parsed.ok ? 'OK' : 'FAILED'} — ${parsed.detail}`);

  return { content };
}
