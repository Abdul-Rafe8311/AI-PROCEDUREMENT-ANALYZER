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
import { type DeepDoc, DeepSearchStatus } from '@/components/workspace/deep-search-status';
import { UserMenu } from '@/components/auth/user-menu';
import { HistoryMenu } from '@/components/auth/history-menu';
import { useAuth } from '@/lib/auth-context';
import { type HistoryItem, insertAnalysisRow, loadUserHistory } from '@/lib/analysis-history';
import { isSupabaseConfigured, STORAGE_BUCKET, supabase } from '@/lib/supabase';
import {
  applyFxRates,
  buildAnalysis,
  classifyQuestion,
  isDeselectIntent,
  isSelectionIntent,
  normalizeRestoredAnalysis,
  resolveSupplierFromText,
} from '@/lib/analysis-engine';
import { useFxRates } from '@/lib/use-fx-rates';
import {
  type IndexStatus,
  type SearchFailure,
  answerFromChunks,
  searchDocument,
  startIndexing,
} from '@/lib/rag-client';
import { type AnalysisResult, CHART_METRICS, type ChartDirective, type ChatMessage } from '@/lib/workspace-types';

// Points the next page load at the session to restore (analysis + chat + charts).
const LAST_ANALYSIS_KEY = 'workspace:lastAnalysisId';
// The human's chosen supplier, persisted per supplier-set so it survives reload.
const SELECTION_KEY = 'workspace:selection:v1';

// The deep-search index status lives on the Supabase `documents` row (written by
// the RAG indexer): index_status, chunk_count, indexed_chunks, index_error. We read
// it straight from Supabase — the source of truth — so the indicator works even
// without the optional Render status endpoint (NEXT_PUBLIC_API_URL). The DB uses
// pending/processing/ready/error (older rows: indexing/failed); normalize both.
function normalizeIndexStatus(s: unknown): IndexStatus {
  switch (String(s ?? '').toLowerCase()) {
    case 'ready':
      return 'ready';
    case 'processing':
    case 'indexing':
      return 'indexing';
    case 'error':
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'unknown';
  }
}

interface DocIndexInfo {
  status: IndexStatus;
  error: string | null;
  chunkCount: number;
  indexedChunks: number;
}

// Read the per-document index status for a set of document ids from Supabase.
// Returns an empty map (never throws) when Supabase isn't configured or the read
// fails, so polling/restoring degrades quietly to the last known state.
async function readDocIndexStatus(ids: string[]): Promise<Map<string, DocIndexInfo>> {
  const out = new Map<string, DocIndexInfo>();
  if (!isSupabaseConfigured || !supabase || !ids.length) return out;
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('id, index_status, index_error, chunk_count, indexed_chunks')
      .in('id', ids);
    if (error || !Array.isArray(data)) return out;
    for (const d of data as Record<string, unknown>[]) {
      out.set(String(d.id), {
        status: normalizeIndexStatus(d.index_status),
        error: (d.index_error as string | null) ?? null,
        chunkCount: Number(d.chunk_count ?? 0),
        indexedChunks: Number(d.indexed_chunks ?? 0),
      });
    }
  } catch {
    /* ignore — keep last known state */
  }
  return out;
}

// Turn a typed retrieval failure into an honest, specific chat message — never a
// vague "temporarily unavailable". Each branch names the actual cause.
function deepSearchFailureMessage(failure: SearchFailure): string {
  switch (failure.kind) {
    case 'not_configured':
      return 'Deep-document search isn’t configured for this deployment (no RAG backend URL). Comparison questions — cost, delivery, payment terms, warranty, risk, scores — still work.';
    case 'cold_start':
    case 'timeout':
      return 'The deep-search service is waking up (it sleeps when idle on the current plan) — I already retried once. Please ask again in a few seconds. Comparison questions work right now.';
    case 'network':
      return 'I couldn’t reach the deep-search service just now. Please try again in a moment. Comparison questions still work.';
    case 'backend_error':
      return `Deep search hit an error (HTTP ${failure.status}: ${failure.detail}). Comparison questions still work while this is looked into.`;
  }
}

export default function WorkspacePage() {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  // The signed-in user's saved sessions (newest first) for the history switcher.
  const [history, setHistory] = useState<HistoryItem[]>([]);
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

  // The human's chosen supplier — overrides the AI anchor for the dashboard and
  // the TA form's Final Recommendation. AI suggests, human decides: this never
  // overwrites the AI recommendation. Persisted per supplier-set.
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const supKey = useMemo(
    () => (displayAnalysis?.quotations ?? []).map((q) => q.id).join('|'),
    [displayAnalysis],
  );
  const aiBest = displayAnalysis?.recommendation?.bestOverall?.supplier ?? null;
  // Restore any persisted selection when the analysed supplier-set changes; drop
  // it if it no longer matches a current supplier.
  useEffect(() => {
    if (!supKey) {
      setSelectedSupplier(null);
      return;
    }
    let stored: string | null = null;
    try {
      const all = JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? '{}');
      stored = typeof all?.[supKey] === 'string' ? all[supKey] : null;
    } catch {
      /* ignore */
    }
    const valid = stored && (displayAnalysis?.quotations ?? []).some((q) => q.supplierName === stored);
    setSelectedSupplier(valid ? stored : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey]);
  // Set/clear the selection and persist it (validated against current suppliers).
  function chooseSupplier(name: string | null) {
    const valid = name && (displayAnalysis?.quotations ?? []).some((q) => q.supplierName === name);
    const next = valid ? name : null;
    setSelectedSupplier(next);
    if (!supKey) return;
    try {
      const all = JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? '{}');
      if (next) all[supKey] = next;
      else delete all[supKey];
      window.localStorage.setItem(SELECTION_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }

  // Per-document deep-search index status (RAG). DeepDoc mirrors the Supabase
  // `documents` row's index_status / chunk_count / indexed_chunks / index_error.
  const [docs, setDocs] = useState<DeepDoc[]>([]);
  const deepSearchReady = docs.some((d) => d.status === 'ready');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the Supabase index status while any document is still pending/indexing.
  useEffect(() => {
    const active = docs.some((d) => d.status === 'pending' || d.status === 'indexing');
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const ids = docs.map((d) => d.documentId);
    const tick = async () => {
      const byId = await readDocIndexStatus(ids);
      if (!byId.size) return;
      setDocs((prev) =>
        prev.map((d) => {
          const s = byId.get(d.documentId);
          return s
            ? { ...d, status: s.status, error: s.error, chunkCount: s.chunkCount, indexedChunks: s.indexedChunks }
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

  // Restore ONE saved session by id: the analysis (comparison results), chat
  // history, and any charts. Restoring existing state only — it never re-runs
  // extraction, scoring, or the LLM. Under Row-Level Security a user can only load
  // a row they own, so this can't surface another user's analysis.
  const restoreSession = useCallback(async (lastId: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    setRestoring(true);
    try {
      const { data: row, error: aErr } = await supabase
        .from('analyses')
        .select('result')
        .eq('id', lastId)
        .maybeSingle();
      if (aErr) return; // transient (or not owned) — keep the pointer, retry next load
      const result = (row?.result ?? null) as AnalysisResult | null;
      // Restore if there are quotations OR a company PR (a PR-only session).
      if (!result || (!result.quotations?.length && !result.purchaseRequisition)) {
        if (typeof window !== 'undefined') window.localStorage.removeItem(LAST_ANALYSIS_KEY);
        return;
      }
      // Upgrade an older persisted analysis to the current shape (rebuilds the
      // PR-item match so a pre-refactor session can't crash the new UI).
      setAnalysis(normalizeRestoredAnalysis(result));
      setAnalysisId(lastId);
      if (typeof window !== 'undefined') window.localStorage.setItem(LAST_ANALYSIS_KEY, lastId);

      // Chat history incl. any charts. select('*') tolerates DBs without the
      // chart column (the chart just won't restore there).
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('analysis_id', lastId)
        .order('created_at', { ascending: true });
      setMessages(
        Array.isArray(msgs)
          ? msgs.map((m: Record<string, unknown>) => {
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
            })
          : [],
      );

      // Restore uploaded PDFs so deep-search chat keeps working after reload,
      // reading their ACTUAL index status/chunk counts from the documents row (not
      // a hardcoded "pending"); the poll then keeps any still-indexing rows fresh.
      const { data: docRows } = await supabase
        .from('documents')
        .select('id, file_name, index_status, index_error, chunk_count, indexed_chunks')
        .eq('analysis_id', lastId);
      const pdfs = Array.isArray(docRows)
        ? docRows.filter((d) => /\.pdf$/i.test(String(d.file_name)))
        : [];
      setDocs(
        pdfs.map((d) => ({
          documentId: String(d.id),
          fileName: String(d.file_name),
          status: normalizeIndexStatus(d.index_status),
          error: (d.index_error as string | null) ?? null,
          chunkCount: Number(d.chunk_count ?? 0),
          indexedChunks: Number(d.indexed_chunks ?? 0),
          startedAt: Date.now(),
        })),
      );
    } catch {
      /* ignore — just start on the upload screen */
    } finally {
      setRestoring(false);
    }
  }, []);

  // Reload the signed-in user's history list (newest first).
  const refreshHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    setHistory(await loadUserHistory(user.id));
  }, [user]);

  // On entering the workspace as a signed-in user, load THEIR history and restore
  // their most recent session (item 8). Falls back to the last session opened on
  // this device when the ownership migration hasn't been applied yet.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    (async () => {
      const items = user ? await loadUserHistory(user.id) : [];
      if (cancelled) return;
      setHistory(items);
      const lastId =
        typeof window !== 'undefined' ? window.localStorage.getItem(LAST_ANALYSIS_KEY) : null;
      const target = items[0]?.id ?? lastId;
      if (target && !cancelled) await restoreSession(target);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
      // Own the analysis when signed in (Phase 2). insertAnalysisRow falls back to
      // an ownerless insert if the DB predates the user_id column, so uploads never
      // break before the ownership migration is applied.
      await insertAnalysisRow(id, title, user?.id ?? null);

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
        // Remember this session so a reload restores it (see the restore effect),
        // and surface it in the user's history switcher.
        if (typeof window !== 'undefined') window.localStorage.setItem(LAST_ANALYSIS_KEY, persisted.id);
        void refreshHistory();
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

    // Supplier selection override, handled before routing ("go with Alfran",
    // "back to the AI pick"). AI suggests, human decides — the AI recommendation
    // is never overwritten; selection just re-anchors the dashboard + TA form.
    const quotes = (displayAnalysis ?? analysis).quotations;
    if (isDeselectIntent(text) && selectedSupplier) {
      chooseSupplier(null);
      push(
        `Cleared your selection — the dashboard is back to the AI recommendation${aiBest ? ` (${aiBest})` : ''}.`,
      );
      return;
    }
    if (isSelectionIntent(text)) {
      const name = resolveSupplierFromText(text, quotes);
      if (name) {
        if (name === selectedSupplier) {
          push(`${name} is already your selected supplier.`);
        } else {
          chooseSupplier(name);
          push(
            `Selected ${name} as your chosen supplier. The dashboard and potential savings are now re-anchored to ${name}` +
              (aiBest && aiBest !== name
                ? ` — the AI still suggests ${aiBest}, and the trade-off panel shows the cost, delivery and score deltas vs the AI pick.`
                : '.') +
              ' It also carries into the Technical Approval Form’s Final Recommendation (still yours to edit).',
          );
        }
        return;
      }
    }

    // Route: comparison questions -> analysis JSON; document questions -> RAG.
    const kind = classifyQuestion(text, deepSearchReady);
    if (kind === 'document') {
      const ready = docs.filter((d) => d.status === 'ready');
      if (!ready.length) {
        const indexingDoc = docs.find((d) => d.status === 'indexing' || d.status === 'pending');
        const failed = docs.find((d) => d.status === 'failed');
        if (indexingDoc) {
          const pct =
            indexingDoc.chunkCount > 0
              ? Math.min(99, Math.round((indexingDoc.indexedChunks / indexingDoc.chunkCount) * 100))
              : null;
          push(
            `Still reading your documents — deep-document search will be ready in a few seconds${
              pct != null ? ` (${pct}% indexed)` : ''
            }. Ask again in a moment, or ask a comparison question (cost, delivery, payment terms, warranty) now.`,
          );
        } else if (failed) {
          push(
            `Deep search isn’t available for this upload (${failed.error ?? 'indexing failed'}). I can still answer comparison questions (cost, delivery, payment terms, warranty, risk, scores).`,
          );
        } else {
          push(
            'Deep document search isn’t available for this upload. I can answer comparison questions (cost, delivery, payment terms, warranty, risk, scores).',
          );
        }
        return;
      }
      try {
        setSending(true);
        // Scope to the first ready document; label which one when multiple.
        const target = ready[0];
        const outcome = await searchDocument(target.documentId, text);
        if (!outcome.ok) {
          push(deepSearchFailureMessage(outcome.failure));
          return;
        }
        const result = outcome.result;
        // The backend can itself report an internal error (e.g. embedding model
        // failed to load on a woken instance) — surface the real reason.
        if (result.status === 'error') {
          push(
            `Deep search hit an error: ${result.message ?? 'unknown error'}. Comparison questions (cost, delivery, payment terms, warranty) still work.`,
          );
          return;
        }
        // Race: the doc flipped out of 'ready' or is mid-reindex on the backend.
        if (result.status !== 'ready' && !result.chunks.length) {
          push(
            result.message ??
              'That document is still being prepared for deep search — please try again in a moment.',
          );
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
            <HistoryMenu items={history} currentId={analysisId} onOpen={restoreSession} />
            <ThemeToggle />
            <Link
              href="/"
              className="hidden items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Analyze supplier quotations
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-muted-foreground">
            Upload your quotations and get an AI comparison, recommendation, and risk check. Your
            analyses are saved to your account.
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
            <AnalysisResults
              analysis={displayAnalysis}
              selectedSupplier={selectedSupplier}
              onSelectSupplier={chooseSupplier}
            />
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
