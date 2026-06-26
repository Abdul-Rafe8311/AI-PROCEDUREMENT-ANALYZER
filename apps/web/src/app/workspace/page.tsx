'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UploadZone } from '@/components/workspace/upload-zone';
import { AnalysisResults } from '@/components/workspace/analysis-results';
import { ExtractionDebug } from '@/components/workspace/extraction-debug';
import { ChatPanel } from '@/components/workspace/chat-panel';
import { isSupabaseConfigured, STORAGE_BUCKET, supabase } from '@/lib/supabase';
import { buildAnalysis, classifyQuestion } from '@/lib/analysis-engine';
import {
  type DocStatus,
  type IndexStatus,
  fetchStatus,
  searchDocument,
  startIndexing,
} from '@/lib/rag-client';
import type { AnalysisResult, ChatMessage } from '@/lib/workspace-types';

export default function WorkspacePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-document deep-search index status (RAG).
  interface DocEntry {
    documentId: string;
    fileName: string;
    status: IndexStatus;
    error: string | null;
  }
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const deepSearchReady = docs.some((d) => d.status === 'ready');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll index status while any document is still pending/indexing.
  useEffect(() => {
    const active = docs.filter((d) => d.status === 'pending' || d.status === 'indexing');
    if (!active.length) {
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
          return s ? { ...d, status: s.status, error: s.error } : d;
        }),
      );
    };
    pollRef.current = setInterval(tick, 3000);
    void tick();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [docs]);

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
      const { error: aErr } = await supabase
        .from('analyses')
        .insert({ id, title: files.map((f) => f.name).join(', ').slice(0, 120) });
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
    if (!files.length) return;
    setError(null);
    setDocs([]);
    const persisted = await persistUpload();

    try {
      setAnalyzing(true);
      // Send the actual file bytes for real extraction.
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
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
        // Kick off background deep-search indexing for PDF documents.
        const pdfs = persisted.docs.filter((d) => d.isPdf);
        if (pdfs.length) {
          setDocs(
            pdfs.map((d) => ({
              documentId: d.documentId,
              fileName: d.fileName,
              status: 'pending' as IndexStatus,
              error: null,
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

  async function persistMessage(role: ChatMessage['role'], content: string) {
    if (!isSupabaseConfigured || !supabase || !analysisId) return;
    try {
      await supabase.from('messages').insert({ analysis_id: analysisId, role, content });
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
        // Phase: scope to the first ready document; label which one.
        const target = ready[0];
        const result = await searchDocument(target.documentId, text);
        if (!result) {
          push('Deep search is temporarily unavailable. Please try again shortly.');
          return;
        }
        const cites = result.citations?.length
          ? `\n\nSources: ${result.citations.map((c) => `p.${c.page}`).join(', ')}`
          : '';
        const label = ready.length > 1 ? `From ${target.fileName}:\n\n` : '';
        push(`${label}${result.answer}${cites}`);
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
          analysis,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const answer: string = data?.answer ?? 'Sorry, I could not answer that.';
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: answer,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      void persistMessage('assistant', answer);
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
          <div className="mx-auto max-w-2xl">
            <UploadZone
              files={files}
              onAdd={addFiles}
              onRemove={removeFile}
              onAnalyze={handleAnalyze}
              busy={uploading}
              analyzing={analyzing}
            />
            <div className="mt-3 text-center">
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

          {error && (
            <div className="mx-auto max-w-2xl whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {analysis?.debug && <ExtractionDebug debug={analysis.debug} />}

          {analysis && <AnalysisResults analysis={analysis} />}

          {docs.length > 0 && <DeepSearchStatus docs={docs} />}

          <ChatPanel
            messages={messages}
            onSend={handleSend}
            sending={sending}
            disabled={!analysis}
          />
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          {isSupabaseConfigured
            ? 'Uploads and history are saved to your Supabase project.'
            : 'Running in demo mode — add Supabase keys to persist uploads and history.'}
        </p>
      </main>
    </div>
  );
}

function DeepSearchStatus({
  docs,
}: {
  docs: { documentId: string; fileName: string; status: IndexStatus; error: string | null }[];
}) {
  const meta: Record<IndexStatus, { label: string; cls: string; dot: string }> = {
    pending: { label: 'Queued for deep search', cls: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
    indexing: { label: 'Indexing for deep search…', cls: 'text-primary', dot: 'bg-primary animate-pulse' },
    ready: { label: 'Deep search ready', cls: 'text-success', dot: 'bg-success' },
    failed: { label: 'Deep search unavailable', cls: 'text-warning', dot: 'bg-warning' },
    unknown: { label: 'Unknown', cls: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Deep document search
      </div>
      <ul className="space-y-1.5">
        {docs.map((d) => {
          const m = meta[d.status];
          return (
            <li key={d.documentId} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
              <span className="truncate font-medium">{d.fileName}</span>
              <span className={`shrink-0 ${m.cls}`}>· {m.label}</span>
              {d.status === 'failed' && d.error && (
                <span className="truncate text-xs text-muted-foreground" title={d.error}>
                  — {d.error}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
