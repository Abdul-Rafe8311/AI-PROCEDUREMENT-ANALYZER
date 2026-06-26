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

export interface DeepAnswer {
  answer: string;
  citations: { page: number; snippet: string }[];
  status: string;
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

export async function searchDocument(documentId: string, query: string): Promise<DeepAnswer | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/public/rag/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, query }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DeepAnswer;
  } catch {
    return null;
  }
}
