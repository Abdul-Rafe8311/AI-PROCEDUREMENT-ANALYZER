'use client';

import { useEffect, useState } from 'react';
import type { IndexStatus } from '@/lib/rag-client';

// One uploaded PDF's deep-search (RAG) index state, mirrored from the Supabase
// `documents` row: index_status, index_error, chunk_count, indexed_chunks.
export interface DeepDoc {
  documentId: string;
  fileName: string;
  status: IndexStatus;
  error: string | null;
  chunkCount: number;
  indexedChunks: number;
  startedAt: number;
}

// Per-document indicator shown near the Chat panel: for every uploaded PDF it shows
// the file name, its index status, and the indexed/total chunk count — plus the
// indexer's error text when one exists. Honest by construction: it never implies the
// chat can be searched while a document is still pending/indexing, and never hides an
// error.
export function DeepSearchStatus({ docs }: { docs: DeepDoc[] }) {
  // Self-tick so the "Starting shortly…" hint appears even if status polling
  // returns nothing (e.g. backend waking up).
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const active = docs.some((d) => d.status === 'pending' || d.status === 'indexing');
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [docs]);

  const dot: Record<IndexStatus, string> = {
    pending: 'bg-muted-foreground/50',
    indexing: 'bg-primary animate-pulse',
    ready: 'bg-success',
    failed: 'bg-warning',
    unknown: 'bg-muted-foreground/50',
  };

  // Honest, never-silent status text. Always surfaces the indexed/total chunk count
  // when known, and never implies the chat is searchable while a doc is still being
  // read (pending/indexing).
  const chunks = (d: DeepDoc) => (d.chunkCount > 0 ? ` · ${d.indexedChunks} / ${d.chunkCount} chunks` : '');
  const describe = (d: DeepDoc): { label: string; cls: string } => {
    switch (d.status) {
      case 'indexing': {
        const pct = d.chunkCount > 0 ? Math.min(100, Math.round((d.indexedChunks / d.chunkCount) * 100)) : null;
        return {
          cls: 'text-primary',
          label: `Indexing for deep search…${pct != null ? ` ${pct}%` : ''}${chunks(d)}`,
        };
      }
      case 'ready':
        return { cls: 'text-success', label: `Ready for deep search${chunks(d)}` };
      case 'failed':
        return { cls: 'text-warning', label: 'Deep search unavailable' };
      case 'unknown':
        return { cls: 'text-muted-foreground', label: 'Index status unknown — not yet searchable' };
      case 'pending':
      default: {
        const stuck = Date.now() - d.startedAt > 30_000;
        return {
          cls: 'text-muted-foreground',
          label: (stuck ? 'Starting shortly…' : 'Queued for deep search') + ' (not yet searchable)',
        };
      }
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Deep document search
      </div>
      <ul className="space-y-2">
        {docs.map((d) => {
          const { label, cls } = describe(d);
          const pct =
            d.status === 'indexing' && d.chunkCount > 0
              ? Math.min(100, Math.round((d.indexedChunks / d.chunkCount) * 100))
              : null;
          return (
            <li key={d.documentId} className="text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[d.status]}`} />
                <span className="max-w-[16rem] truncate font-medium">{d.fileName}</span>
                <span className={`shrink-0 ${cls}`}>· {label}</span>
              </div>
              {/* Never fail silently: show the indexer's error whenever one exists. */}
              {d.error && (
                <p className="ml-3.5 mt-0.5 text-xs text-warning" title={d.error}>
                  {d.error}
                </p>
              )}
              {pct != null && (
                <div className="ml-3.5 mt-1 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
