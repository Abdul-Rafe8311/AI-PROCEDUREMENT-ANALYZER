// Decides WHICH AI provider handles a given uploaded document — once, before any
// extraction runs — so the same decision serves both the Technical Approval Form
// extraction and the Tender Comparative Sheet fill for that document.
//
// The point is credit control: Claude is reserved for the documents that
// genuinely need it, and everything else goes to Groq.
//
// >> GROQ ROUTING IS CURRENTLY DISABLED — see GROQ_ROUTING_ENABLED below. Every
// >> document resolves to Claude today. Rule 3 is the only one Groq would serve,
// >> and it is pinned to Claude until the empty-extraction cause is found.
//
// ── The rule, in priority order ─────────────────────────────────────────────
//   1. Needs translation (Arabic / bilingual)  -> Claude
//        Only Claude has the translation path this codebase uses, and the
//        Arabic RTL table rescue depends on it.
//   2. No usable text layer (scanned / image)  -> Claude
//        Reading it at all requires vision. Groq's llama-3.3-70b-versatile is
//        text-only, so it physically cannot do this.
//   3. Otherwise (digital PDF, English)        -> Groq (disabled: -> Claude)
//
// ── Why this is safe to compute once ────────────────────────────────────────
// Both signals come from the extracted TEXT, and extraction of that text is
// pdf.js only — no model call, no credit spend. So the router is a pure function
// of (text, fileName): same input, same decision, no side effects. The caller
// runs it once per document and passes the result to both consumers, which is
// what stops the TA form and the tender sheet ever disagreeing about a document.

import { detectLanguage } from './extraction-server';

export type LlmProvider = 'claude' | 'groq';

export type RouteReason =
  /** Arabic or bilingual — needs the translation path, which is Claude-only */
  | 'needs-translation'
  /** no usable text layer — needs vision, which Groq cannot do */
  | 'scanned-no-text-layer'
  /** ordinary digital English document */
  | 'digital-text';

export interface DocumentRoute {
  provider: LlmProvider;
  reason: RouteReason;
  /** what detectLanguage saw — carried for the label and the logs */
  language: 'en' | 'ar' | 'bilingual';
  /** characters of usable text; 0 means scanned */
  textLength: number;
  /** one line, safe to log or show next to a result */
  label: string;
}

/** Below this, a "text layer" is page furniture (headers, page numbers), not content. */
const MIN_TEXT_CHARS = 200;

/**
 * ── GROQ ROUTING IS DISABLED ────────────────────────────────────────────────
 * Every document goes to Claude, exactly as before routing existed.
 *
 * Turned off after the first live run: three of five suppliers extracted empty
 * ("Not found" across every field, score 0) once digital English PDFs began
 * going to Groq. The cause was never established — the diagnostic logging on the
 * Groq path went in but no failing run was captured — so this is disabled rather
 * than fixed.
 *
 * The detection below still RUNS and still reports what a document is, so the
 * reason and the provenance label stay truthful; only the provider is pinned.
 * Flip this to true to re-enable, and expect to need the llm-provider diagnostics
 * to finish the investigation.
 */
const GROQ_ROUTING_ENABLED = false;

/**
 * Route ONE document. `text` is the output of extractText() for that document —
 * pass the same string that will later be sent to the model, so the decision and
 * the work are made on identical input.
 */
export function routeDocument(text: string, fileName?: string): DocumentRoute {
  const body = String(text ?? '');
  const textLength = body.trim().length;

  // 1. Translation first: an Arabic document must go to Claude even when it has a
  //    perfectly good text layer, because the translation and the RTL table rescue
  //    live only on that path.
  const language = textLength > 0 ? detectLanguage(body) : 'en';
  if (language === 'ar' || language === 'bilingual') {
    return route('claude', 'needs-translation', language, textLength, fileName);
  }

  // 2. No usable text layer -> vision -> Claude. A handful of characters is not a
  //    text layer; the existing pipeline treats an empty read as scanned, and this
  //    threshold additionally catches a PDF whose only extractable text is a
  //    letterhead, which would otherwise be routed to a model that cannot see it.
  if (textLength < MIN_TEXT_CHARS) {
    return route('claude', 'scanned-no-text-layer', language, textLength, fileName);
  }

  // 3. Ordinary digital English document — the only case Groq would ever serve.
  //    While routing is disabled this still resolves to Claude; the reason stays
  //    'digital-text' because that is genuinely what the document is.
  return route(
    GROQ_ROUTING_ENABLED ? 'groq' : 'claude',
    'digital-text',
    language,
    textLength,
    fileName,
  );
}

const REASON_TEXT: Record<RouteReason, string> = {
  'needs-translation': 'Arabic source — translation required',
  'scanned-no-text-layer': 'scanned document — vision required',
  'digital-text': 'digital English document',
};

function route(
  provider: LlmProvider,
  reason: RouteReason,
  language: DocumentRoute['language'],
  textLength: number,
  fileName?: string,
): DocumentRoute {
  const who = provider === 'claude' ? 'Claude' : 'Groq';
  return {
    provider,
    reason,
    language,
    textLength,
    label: `Extracted via ${who} (${REASON_TEXT[reason]})${fileName ? ` — ${fileName}` : ''}`,
  };
}

/** True when this document must stay on Claude regardless of any user preference. */
export const isClaudeRequired = (r: DocumentRoute): boolean => r.provider === 'claude';

/** Whether any document can currently be routed to Groq. */
export const isGroqRoutingEnabled = (): boolean => GROQ_ROUTING_ENABLED;
