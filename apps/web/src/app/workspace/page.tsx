'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UploadZone } from '@/components/workspace/upload-zone';
import { PrUpload } from '@/components/workspace/pr-upload';
import { PrSummary } from '@/components/workspace/pr-summary';
import { AnalysisResults } from '@/components/workspace/analysis-results';
import { ExtractionDebug } from '@/components/workspace/extraction-debug';
import { ChatPanel } from '@/components/workspace/chat-panel';
import { isSupabaseConfigured, STORAGE_BUCKET, supabase } from '@/lib/supabase';
import { applyFxRates, buildAnalysis, classifyQuestion, normalizeRestoredAnalysis } from '@/lib/analysis-engine';
import { useFxRates } from '@/lib/use-fx-rates';
import {
  type DocStatus,
  type IndexStatus,
  answerFromChunks,
  fetchStatus,
  searchDocument,
  startIndexing,
} from '@/lib/rag-client';
import { type AnalysisResult, CHART_METRICS, type ChartDirective, type ChatMessage } from '@/lib/workspace-types';

// Points the next page load at the session to restore (analysis + chat + charts).
const LAST_ANALYSIS_KEY = 'workspace:lastAnalysisId';

export default function WorkspacePage() {
  const [files, setFiles] = useState<File[]>([]);
  // The company's own Purchase Requisition (optional second document type).
  const [prFile, setPrFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  // Single live FX source for the whole UI. Every USD figure (comparison view,
  // dashboard, savings, charts, chat, TA form) is derived from this — so they all
  // agree and never use a stale/hardcoded rate. Raw `analysis` is kept for
  // persistence; `displayAnalysis` is what the UI and chat consume.
  const fxLive = useFxRates();
  const displayAnalysis = useMemo(
    () => (analysis ? applyFxRates(analysis, fxLive) : null),
    [analysis, fxLive],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-document deep-search index status (RAG).
  interface DocEntry {
    documentId: string;
    fileName: string;
    status: IndexStatus;
    error: string | null;
    chunkCount: number;
    indexedChunks: number;
    startedAt: number; // when we began tracking (for the "stuck pending" hint)
  }
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const deepSearchReady = docs.some((d) => d.status === 'ready');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll index status while any document is still pending/indexing.
  useEffect(() => {
    const active = docs.some((d) => d.status === 'pending' || d.status === 'indexing');
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const ids = docs.map((d) => d.documentId);
    const tick = async () => {
      const statuses = await fetchStatus(ids);
      if (!statuses.length) return;
      const byId = new Map<string, DocStatus>(statuses.map((s) => [s.documentId, s]));
      setDocs((prev) =>
        prev.map((d) => {
          const s = byId.get(d.documentId);
          return s
            ? {
                ...d,
                status: s.status,
                error: s.error,
                chunkCount: s.chunkCount,
                indexedChunks: s.indexedChunks,
              }
            : d;
        }),
      );
    };
    pollRef.current = setInterval(tick, 3000);
    void tick();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [docs]);

  // Restore a previous session on load/refresh: the saved analysis (comparison
  // results), chat history, and any charts. Scoped to restoring existing state —
  // it never re-runs extraction, scoring, or the LLM.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const lastId =
      typeof window !== 'undefined' ? window.localStorage.getItem(LAST_ANALYSIS_KEY) : null;
    if (!lastId) return;
    let cancelled = false;

    (async () => {
      setRestoring(true);
      try {
        const { data: row, error: aErr } = await supabase!
          .from('analyses')
          .select('result')
          .eq('id', lastId)
          .maybeSingle();
        if (aErr) return; // transient — keep the pointer and retry next load
        const result = (row?.result ?? null) as AnalysisResult | null;
        // Restore if there are quotations OR a company PR (a PR-only session).
        if (!result || (!result.quotations?.length && !result.purchaseRequisition)) {
          window.localStorage.removeItem(LAST_ANALYSIS_KEY); // genuinely gone
          return;
        }
        if (cancelled) return;
        // Upgrade an older persisted analysis to the current shape (rebuilds the
        // PR-item match so a pre-refactor session can't crash the new UI).
        setAnalysis(normalizeRestoredAnalysis(result));
        setAnalysisId(lastId);

        // Chat history incl. any charts. select('*') tolerates DBs without the
        // chart column (the chart just won't restore there).
        const { data: msgs } = await supabase!
          .from('messages')
          .select('*')
          .eq('analysis_id', lastId)
          .order('created_at', { ascending: true });
        if (!cancelled && Array.isArray(msgs) && msgs.length) {
          setMessages(
            msgs.map((m: Record<string, unknown>) => {
              const chart = m.chart as ChartDirective | null | undefined;
              const valid =
                !!chart && CHART_METRICS.includes(chart.metric as (typeof CHART_METRICS)[number]);
              return {
                id: String(m.id),
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: String(m.content ?? ''),
                createdAt: String(m.created_at ?? new Date().toISOString()),
                ...(valid
                  ? { chart: { metric: chart!.metric, ...(chart!.title ? { title: chart!.title } : {}) } }
                  : {}),
              } as ChatMessage;
            }),
          );
        }

        // Restore uploaded PDFs so deep-search chat keeps working after reload;
        // the existing status poll picks up their (already-indexed) state.
        const { data: docRows } = await supabase!
          .from('documents')
          .select('id, file_name')
          .eq('analysis_id', lastId);
        if (!cancelled && Array.isArray(docRows)) {
          const pdfs = docRows.filter((d) => /\.pdf$/i.test(String(d.file_name)));
          if (pdfs.length) {
            setDocs(
              pdfs.map((d) => ({
                documentId: String(d.id),
                fileName: String(d.file_name),
                status: 'pending' as IndexStatus,
                error: null,
                chunkCount: 0,
                indexedChunks: 0,
                startedAt: Date.now(),
              })),
            );
          }
        }
      } catch {
        /* ignore — just start on the upload screen */
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        if (!seen.has(`${f.name}:${f.size}`)) merged.push(f);
      }
      return merged;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Best-effort upload + persistence. Never blocks the analysis flow.
  // Returns the analysis id and the created document records (for RAG indexing).
  async function persistUpload(): Promise<{
    id: string;
    docs: { documentId: string; fileName: string; fileUrl: string; isPdf: boolean }[];
  } | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      setUploading(true);
      const id = crypto.randomUUID();
      const title = [...files.map((f) => f.name), prFile?.name]
        .filter(Boolean)
        .join(', ')
        .slice(0, 120);
      const { error: aErr } = await supabase.from('analyses').insert({ id, title });
      if (aErr) throw aErr;

      const docs: { documentId: string; fileName: string; fileUrl: string; isPdf: boolean }[] = [];
      for (const file of files) {
        const path = `${id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) continue;
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        const { data: inserted } = await supabase
          .from('documents')
          .insert({ analysis_id: id, file_name: file.name, file_url: pub.publicUrl })
          .select('id')
          .single();
        if (inserted?.id) {
          docs.push({
            documentId: inserted.id,
            fileName: file.name,
            fileUrl: pub.publicUrl,
            isPdf: /\.pdf$/i.test(file.name) || file.type === 'application/pdf',
          });
        }
      }
      setAnalysisId(id);
      return { id, docs };
    } catch {
      return null; // degrade silently to in-session mode
    } finally {
      setUploading(false);
    }
  }

  async function handleAnalyze() {
    if (!files.length && !prFile) return;
    setError(null);
    setDocs([]);
    const persisted = await persistUpload();

    try {
      setAnalyzing(true);
      // Send the actual file bytes for real extraction. Supplier quotations go
      // under "files"; the optional company Purchase Requisition goes under "pr".
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      if (prFile) form.append('pr', prFile, prFile.name);
      const res = await fetch('/api/extract', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        // Clear error state — never silently substitute sample data.
        setAnalysis(null);
        const base =
          data?.error ??
          'Could not extract data from the uploaded file(s). Please try a text-based PDF or DOCX.';
        // `detail` is only present in development for debugging.
        setError(data?.detail ? `${base}\n\n${data.detail}` : base);
        return;
      }

      setAnalysis(data as AnalysisResult);
      setMessages([]);
      if (persisted) {
        void persistResult(persisted.id, data as AnalysisResult);
        // Remember this session so a reload restores it (see the restore effect).
        if (typeof window !== 'undefined') window.localStorage.setItem(LAST_ANALYSIS_KEY, persisted.id);
        // Kick off background deep-search indexing for PDF documents.
        const pdfs = persisted.docs.filter((d) => d.isPdf);
        if (pdfs.length) {
          setDocs(
            pdfs.map((d) => ({
              documentId: d.documentId,
              fileName: d.fileName,
              status: 'pending' as IndexStatus,
              error: null,
              chunkCount: 0,
              indexedChunks: 0,
              startedAt: Date.now(),
            })),
          );
          pdfs.forEach((d) => void startIndexing(d.documentId, d.fileUrl));
        }
      }
    } catch {
      setAnalysis(null);
      setError('Could not reach the extraction service. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  // Sample analysis is only ever shown via this explicit action.
  function loadSample() {
    setError(null);
    setMessages([]);
    setAnalysis(buildAnalysis([]));
  }

  // Best-effort: store the full analysis (with per-field source + confidence).
  async function persistResult(id: string, result: AnalysisResult) {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      await supabase.from('analyses').update({ result }).eq('id', id);
    } catch {
      /* ignore — requires the analyses.result column (see supabase/schema.sql) */
    }
  }

  async function persistMessage(role: ChatMessage['role'], content: string, chart?: ChartDirective) {
    if (!isSupabaseConfigured || !supabase || !analysisId) return;
    try {
      // `chart` needs the messages.chart jsonb column (see supabase/schema.sql).
      // If it isn't migrated yet the insert throws and is ignored — no breakage.
      await supabase.from('messages').insert({ analysis_id: analysisId, role, content, ...(chart ? { chart } : {}) });
    } catch {
      /* ignore */
    }
  }

  async function handleSend(text: string) {
    if (!analysis) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    void persistMessage('user', text);

    const push = (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content, createdAt: new Date().toISOString() },
      ]);
      void persistMessage('assistant', content);
    };

    // Route: comparison questions -> analysis JSON; document questions -> RAG.
    const kind = classifyQuestion(text, deepSearchReady);
    if (kind === 'document') {
      const ready = docs.filter((d) => d.status === 'ready');
      if (!ready.length) {
        const indexing = docs.some((d) => d.status === 'indexing' || d.status === 'pending');
        const failed = docs.find((d) => d.status === 'failed');
        push(
          indexing
            ? 'That looks like a question about the document’s wording. It’s still being indexed for deep search — please try again in a moment.'
            : failed
              ? `Deep search isn’t available for this upload (${failed.error ?? 'indexing failed'}). I can still answer comparison questions.`
              : 'Deep document search isn’t available for this upload. I can answer comparison questions (cost, delivery, payment terms, warranty, risk, scores).',
        );
        return;
      }
      try {
        setSending(true);
        // Scope to the first ready document; label which one when multiple.
        const target = ready[0];
        const result = await searchDocument(target.documentId, text);
        if (!result) {
          push('Deep search is temporarily unavailable. Please try again shortly.');
          return;
        }
        if (!result.chunks.length) {
          push(result.message ?? 'I could not find anything relevant in the document.');
          return;
        }
        // Retrieval on Render -> synthesize a real answer on Vercel (Claude).
        const synth = await answerFromChunks(text, result.fileName ?? target.fileName, result.chunks);
        const answer = synth?.answer ?? result.chunks[0].content;
        const pages = synth?.citations?.length
          ? synth.citations.map((c) => c.page)
          : [...new Set(result.chunks.map((c) => c.page))].sort((a, b) => a - b);
        const cites = pages.length ? `\n\nSources: ${pages.map((p) => `p.${p}`).join(', ')}` : '';
        const label = ready.length > 1 ? `From ${target.fileName}:\n\n` : '';
        const notice = synth?.notice ? `\n\n⚠️ ${synth.notice}` : '';
        push(`${label}${answer}${cites}${notice}`);
      } finally {
        setSending(false);
      }
      return;
    }

    try {
      setSending(true);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          analysis: displayAnalysis ?? analysis,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const answer: string = data?.answer ?? 'Sorry, I could not answer that.';
      const notice: string = data?.notice ? `\n\n⚠️ ${data.notice}` : '';
      const chart: ChartDirective | undefined =
        data?.chart && CHART_METRICS.includes(data.chart.metric)
          ? { metric: data.chart.metric, ...(data.chart.title ? { title: data.chart.title } : {}) }
          : undefined;
      const content = `${answer}${notice}`;
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
        ...(chart ? { chart } : {}),
      };
      setMessages((prev) => [...prev, aiMsg]);
      void persistMessage('assistant', content, chart);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Something went wrong answering that. Please try again.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">AI Procurement Copilot</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Analyze supplier quotations
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-muted-foreground">
            Upload your quotations and get an AI comparison, recommendation, and risk check — no
            account required.
          </p>
        </div>

        <div className="space-y-8">
          <div className="mx-auto max-w-2xl space-y-4">
            <UploadZone
              files={files}
              onAdd={addFiles}
              onRemove={removeFile}
              onAnalyze={handleAnalyze}
              busy={uploading}
              analyzing={analyzing}
            />
            <PrUpload
              file={prFile}
              onSelect={setPrFile}
              onClear={() => setPrFile(null)}
              busy={uploading}
            />
            {/* Analyze from here when ONLY a PR was uploaded (no quotations yet);
                with quotations present, the button lives in the upload zone. */}
            {files.length === 0 && prFile && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={uploading || analyzing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Reading requisition…
                  </>
                ) : (
                  'Extract Purchase Requisition'
                )}
              </button>
            )}
            <div className="text-center">
              <button
                type="button"
                onClick={loadSample}
                disabled={analyzing}
                className="text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-2 transition hover:text-foreground disabled:opacity-50"
              >
                or load a sample analysis
              </button>
            </div>
          </div>

          {restoring && !analysis && (
            <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Restoring your previous session…
            </div>
          )}

          {error && (
            <div className="mx-auto max-w-2xl whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {analysis?.debug && <ExtractionDebug debug={analysis.debug} />}

          {analysis?.purchaseRequisition && <PrSummary pr={analysis.purchaseRequisition} />}

          {displayAnalysis && displayAnalysis.quotations.length > 0 && (
            <AnalysisResults analysis={displayAnalysis} />
          )}

          {docs.length > 0 && <DeepSearchStatus docs={docs} />}

          <ChatPanel
            messages={messages}
            onSend={handleSend}
            sending={sending}
            disabled={!analysis || analysis.quotations.length === 0}
            analysis={displayAnalysis ?? analysis}
          />
        </div>

      </main>
    </div>
  );
}

interface DeepDoc {
  documentId: string;
  fileName: string;
  status: IndexStatus;
  error: string | null;
  chunkCount: number;
  indexedChunks: number;
  startedAt: number;
}

function DeepSearchStatus({ docs }: { docs: DeepDoc[] }) {
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

  const describe = (d: DeepDoc): { label: string; cls: string } => {
    switch (d.status) {
      case 'indexing': {
        const pct =
          d.chunkCount > 0
            ? Math.min(100, Math.round((d.indexedChunks / d.chunkCount) * 100))
            : null;
        return {
          cls: 'text-primary',
          label: `Indexing for deep search…${pct != null ? ` ${pct}%` : ''}`,
        };
      }
      case 'ready':
        return { cls: 'text-success', label: 'Ready for deep search' };
      case 'failed':
        return { cls: 'text-warning', label: 'Deep search unavailable' };
      case 'pending':
      default: {
        const stuck = Date.now() - d.startedAt > 30_000;
        return {
          cls: 'text-muted-foreground',
          label: stuck ? 'Starting shortly…' : 'Queued for deep search',
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
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[d.status]}`} />
                <span className="truncate font-medium">{d.fileName}</span>
                <span className={`shrink-0 ${cls}`}>· {label}</span>
                {d.status === 'failed' && d.error && (
                  <span className="truncate text-xs text-muted-foreground" title={d.error}>
                    — {d.error}
                  </span>
                )}
              </div>
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
