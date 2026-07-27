'use client';

// The Tender Comparative Sheet controls: Generate, Customize, Download.
// Sits alongside the Technical Approval Form buttons and shares none of its code
// — the TA form is untouched by this feature.

import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Settings2, Sparkles } from 'lucide-react';
import { generateTenderSheet } from '@/lib/tender-sheet/generate';
import { loadTenderSheet, saveTenderSheet } from '@/lib/tender-sheet/store';
import { TenderSheetDialog } from './tender-sheet-dialog';
import type { TenderSheet } from '@/lib/tender-sheet/types';
import type { AnalysisResult } from '@/lib/workspace-types';

export function TenderSheetPanel({
  analysis,
  analysisId,
}: {
  analysis: AnalysisResult;
  /** null when the session was never persisted — the sheet then lives in memory */
  analysisId: string | null;
}) {
  const [sheet, setSheet] = useState<TenderSheet | null>(null);
  const [busy, setBusy] = useState<'generate' | 'download' | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const hasPr = !!analysis.purchaseRequisition?.items.length;
  const providersUsed = [...new Set(analysis.quotations.map((q) => q.route?.provider).filter(Boolean))];
  const providerNote = providersUsed.length
    ? `Extracted via ${providersUsed.map((p) => (p === 'groq' ? 'Groq' : 'Claude')).join(' + ')}`
    : null;

  // Reopen a sheet saved for this analysis.
  useEffect(() => {
    if (!analysisId) return;
    let alive = true;
    void loadTenderSheet(analysisId).then((s) => {
      if (alive && s) setSheet(s);
    });
    return () => {
      alive = false;
    };
  }, [analysisId]);

  async function handleGenerate() {
    if (busy) return;
    setBusy('generate');
    setError(null);
    setNote(null);
    try {
      const { sheet: next, filled, withoutText } = await generateTenderSheet(
        analysisId ?? 'local',
        analysis,
        sheet, // keeps the reviewer's edits — only AI cells refresh
        (p) => setProgress(p.supplier ? `Reading ${p.supplier} (${p.done + 1}/${p.total})…` : null),
      );
      setSheet(next);
      if (analysisId) void saveTenderSheet(analysisId, next);
      setNote(
        [
          `${filled} value${filled === 1 ? '' : 's'} read from the quotations.`,
          withoutText.length
            ? `No readable text for: ${withoutText.join(', ')} — those columns need filling by hand.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (err) {
      setError((err as Error).message || 'Could not build the tender sheet.');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleDownload() {
    if (!sheet || busy) return;
    setBusy('download');
    setError(null);
    try {
      const res = await fetch('/api/tender-sheet/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, fileName: `tender-comparative-${sheet.template.prNumber ?? ''}` }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tender-comparative-sheet-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError((err as Error).message || 'Could not download the sheet.');
    } finally {
      setBusy(null);
    }
  }

  function handleEdited(next: TenderSheet) {
    setSheet(next);
    if (analysisId) void saveTenderSheet(analysisId, next);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Tender Comparative Sheet</h3>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        The buyer&apos;s side-by-side technical comparison — specs, chemical analysis, physical and thermal
        properties, and commercial terms — read from the same quotations, editable before export to Excel.
      </p>

      {!hasPr ? (
        <p className="text-sm text-muted-foreground">
          Upload the company Purchase Requisition to build a tender sheet — its items are the sheet&apos;s rows.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!!busy}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy === 'generate' ? 'Generating…' : sheet ? 'Regenerate Sheet' : 'Generate Sheet'}
          </button>

          <TenderSheetDialog sheet={sheet} onChange={handleEdited}>
            <button
              type="button"
              disabled={!sheet || !!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm transition hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Settings2 className="h-4 w-4" />
              Customize Sheet
            </button>
          </TenderSheetDialog>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!sheet || !!busy}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download Sheet (.xlsx)
          </button>
        </div>
      )}

      {/* Which AI read each document, from the per-document routing decision made
          at upload — so a Groq-filled sheet is never taken for a Claude one. */}
      {providerNote && !progress && (
        <p className="mt-2 text-[11px] text-muted-foreground">{providerNote}</p>
      )}
      {progress && <p className="mt-2 text-[11px] text-muted-foreground">{progress}</p>}
      {note && !progress && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
