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
  chunks: RetrievedChunk[];
}

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
  } catch {
    /* backend unreachable — deep search just won't activate */
  }
}

export async function fetchStatus(ids: string[]): Promise<DocStatus[]> {
  if (!API_BASE || !ids.length) return [];
  try {
    const res = await fetch(`${API_BASE}/api/public/rag/status?ids=${ids.join(',')}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.documents ?? []) as DocStatus[];
  } catch {
    return [];
  }
}

// Retrieve relevance-filtered chunks from the Render backend.
export async function searchDocument(documentId: string, query: string): Promise<SearchResult | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/public/rag/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, query }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SearchResult;
  } catch {
    return null;
  }
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
    if (!res.ok) return null;
    return (await res.json()) as DeepAnswer;
  } catch {
    return null;
  }
}
