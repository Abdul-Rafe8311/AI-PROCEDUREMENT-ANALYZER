// Client for the Render NestJS deep-document RAG endpoints.
// Calls are best-effort: if the backend is unreachable, deep search degrades
// gracefully and the comparison chat keeps working.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export type IndexStatus = 'pending' | 'indexing' | 'ready' | 'failed' | 'unknown';

export interface DocStatus {
  documentId: string;
  status: IndexStatus;
  error: string | null;
  chunkCount: number;
  indexedChunks: number;
}

export interface RetrievedChunk {
  page: number;
  content: string;
  distance: number;
}

export interface SearchResult {
  status: string;
  fileName: string | null;
  message: string | null;
  /** classified reason when status === 'error' (embedding_failed | db_error | …) */
  reason?: string;
  chunks: RetrievedChunk[];
}

// Why a deep-search RETRIEVAL request failed, so the UI can say something honest
// instead of a generic "temporarily unavailable". Never swallowed to null.
export type SearchFailure =
  | { kind: 'not_configured' }
  // Render free tier spins the backend down when idle; the first request after
  // that wakes it (gateway 502/503/504 or a long hang we time out).
  | { kind: 'cold_start'; detail: string }
  | { kind: 'timeout'; detail: string }
  | { kind: 'network'; detail: string }
  | { kind: 'backend_error'; status: number; detail: string };

export type SearchOutcome =
  | { ok: true; result: SearchResult }
  | { ok: false; failure: SearchFailure };

export interface DeepAnswer {
  answer: string;
  citations: { page: number }[];
  /** 'claude' (AI) | 'extract' (degraded — raw passages) */
  source?: string;
  /** set when degraded (e.g. key missing / AI unavailable) — surfaced to the user */
  notice?: string;
}

export const ragEnabled = Boolean(API_BASE);

export async function startIndexing(documentId: string, fileUrl: string): Promise<void> {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/api/public/rag/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, fileUrl }),
    });
  } catch (err) {
    // Backend unreachable — deep search just won't activate. Log the real reason
    // (was silently swallowed) so a cold start / bad URL is visible in the console.
    console.warn(`[rag] startIndexing(${documentId}) failed:`, (err as Error).message);
  }
}

export async function fetchStatus(ids: string[]): Promise<DocStatus[]> {
  if (!API_BASE || !ids.length) return [];
  try {
    const res = await fetch(`${API_BASE}/api/public/rag/status?ids=${ids.join(',')}`);
    if (!res.ok) {
      console.warn(`[rag] fetchStatus HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data?.documents ?? []) as DocStatus[];
  } catch (err) {
    console.warn('[rag] fetchStatus failed:', (err as Error).message);
    return [];
  }
}

// Allow a Render cold start (spun-down free-tier instance) to finish before we
// give up; retry a couple of times on gateway/timeout signatures with backoff.
const SEARCH_TIMEOUT_MS = 55_000;
const SEARCH_ATTEMPTS = 2;
const COLD_START_STATUSES = new Set([502, 503, 504]);

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { message?: string; reason?: string };
      return j.message ?? j.reason ?? text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Retrieve relevance-filtered chunks from the Render backend. Returns a typed
// outcome — the REAL failure reason is surfaced (and logged), never collapsed to
// null + a generic "temporarily unavailable".
export async function searchDocument(documentId: string, query: string): Promise<SearchOutcome> {
  if (!API_BASE) return { ok: false, failure: { kind: 'not_configured' } };

  let lastFailure: SearchFailure = { kind: 'network', detail: 'no attempt made' };
  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/api/public/rag/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, query }),
        signal: ctrl.signal,
      });
      const elapsed = Date.now() - startedAt;
      if (res.ok) {
        if (elapsed > 8_000) {
          console.info(`[rag] search succeeded after ${elapsed}ms (attempt ${attempt}) — likely a cold start.`);
        }
        return { ok: true, result: (await res.json()) as SearchResult };
      }
      const detail = await readErrorBody(res);
      if (COLD_START_STATUSES.has(res.status) && attempt < SEARCH_ATTEMPTS) {
        console.warn(`[rag] search HTTP ${res.status} (cold start?) — retrying ${attempt}/${SEARCH_ATTEMPTS}: ${detail}`);
        lastFailure = { kind: 'cold_start', detail: `HTTP ${res.status}: ${detail}` };
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
        continue;
      }
      console.error(`[rag] search failed HTTP ${res.status}: ${detail}`);
      return COLD_START_STATUSES.has(res.status)
        ? { ok: false, failure: { kind: 'cold_start', detail: `HTTP ${res.status}: ${detail}` } }
        : { ok: false, failure: { kind: 'backend_error', status: res.status, detail } };
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      const detail = aborted ? `no response within ${SEARCH_TIMEOUT_MS / 1000}s` : ((err as Error).message ?? String(err));
      console.warn(`[rag] search ${aborted ? 'timed out' : 'network error'} (attempt ${attempt}/${SEARCH_ATTEMPTS}): ${detail}`);
      lastFailure = aborted ? { kind: 'timeout', detail } : { kind: 'network', detail };
      if (attempt < SEARCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
        continue;
      }
      return { ok: false, failure: lastFailure };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, failure: lastFailure };
}

// Synthesize a plain-language answer from retrieved chunks (Vercel/Groq).
export async function answerFromChunks(
  question: string,
  fileName: string | null,
  chunks: RetrievedChunk[],
): Promise<DeepAnswer | null> {
  try {
    const res = await fetch('/api/doc-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, fileName, chunks }),
    });
    if (!res.ok) {
      console.warn(`[rag] answerFromChunks HTTP ${res.status} — falling back to raw passage.`);
      return null;
    }
    return (await res.json()) as DeepAnswer;
  } catch (err) {
    console.warn('[rag] answerFromChunks failed — falling back to raw passage:', (err as Error).message);
    return null;
  }
}
