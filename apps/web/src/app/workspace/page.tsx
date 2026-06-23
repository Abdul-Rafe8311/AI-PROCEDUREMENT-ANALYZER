'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UploadZone } from '@/components/workspace/upload-zone';
import { AnalysisResults } from '@/components/workspace/analysis-results';
import { ExtractionDebug } from '@/components/workspace/extraction-debug';
import { ChatPanel } from '@/components/workspace/chat-panel';
import { isSupabaseConfigured, STORAGE_BUCKET, supabase } from '@/lib/supabase';
import { buildAnalysis } from '@/lib/analysis-engine';
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
  async function persistUpload(): Promise<string | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      setUploading(true);
      const id = crypto.randomUUID();
      const { error: aErr } = await supabase
        .from('analyses')
        .insert({ id, title: files.map((f) => f.name).join(', ').slice(0, 120) });
      if (aErr) throw aErr;

      for (const file of files) {
        const path = `${id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) continue;
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        await supabase
          .from('documents')
          .insert({ analysis_id: id, file_name: file.name, file_url: pub.publicUrl });
      }
      setAnalysisId(id);
      return id;
    } catch {
      return null; // degrade silently to in-session mode
    } finally {
      setUploading(false);
    }
  }

  async function handleAnalyze() {
    if (!files.length) return;
    setError(null);
    const id = await persistUpload();

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
      if (id) void persistResult(id, data as AnalysisResult);
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
