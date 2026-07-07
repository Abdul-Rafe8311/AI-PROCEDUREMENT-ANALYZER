'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { suggestTechnicalComments } from '@/lib/item-matching';
import {
  type AnalysisResult,
  DEFAULT_SIGNATURE_ROLES,
  type TechnicalComment,
} from '@/lib/workspace-types';

interface SigRole {
  id: string;
  label: string;
  enabled: boolean;
}

const STORAGE_KEY = 'approval:signatureRoles';

const makeDefaultRoles = (): SigRole[] =>
  DEFAULT_SIGNATURE_ROLES.map((label, i) => ({ id: `sig-${i}-${label}`, label, enabled: true }));

function loadRoles(): SigRole[] {
  if (typeof window === 'undefined') return makeDefaultRoles();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeDefaultRoles();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((r) => r && typeof r.label === 'string' && typeof r.enabled === 'boolean')) {
      return parsed.map((r, i) => ({ id: r.id ?? `sig-${i}`, label: r.label, enabled: r.enabled }));
    }
  } catch {
    /* ignore */
  }
  return makeDefaultRoles();
}

// Seed every supplier with its AI suggestion (or a blank, editable comment).
function initialComments(
  analysis: AnalysisResult,
  suggestions: Record<string, TechnicalComment>,
): Record<string, TechnicalComment> {
  const out: Record<string, TechnicalComment> = {};
  for (const q of analysis.quotations) {
    out[q.id] = suggestions[q.id] ?? { text: '', aiSuggested: false };
  }
  return out;
}

/**
 * Phase 5 + Technical Comments: the Approval Form download plus a dialog to (a)
 * review/edit the AI-SUGGESTED Technical Comments per supplier and (b) configure
 * the signature blocks (toggle / rename / reorder / add / remove). AI suggestions
 * are marked and stay editable; once a human edits one it becomes a plain
 * human-entered comment. Both feed straight into the generated PDF.
 */
export function ApprovalFormDownload({ analysis }: { analysis: AnalysisResult }) {
  const [roles, setRoles] = useState<SigRole[]>(makeDefaultRoles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition),
    [analysis],
  );
  const [comments, setComments] = useState<Record<string, TechnicalComment>>(() =>
    initialComments(analysis, suggestions),
  );

  useEffect(() => setRoles(loadRoles()), []);
  // Re-seed comments when the analysed set of suppliers changes (new extraction).
  const supKey = analysis.quotations.map((q) => q.id).join('|');
  useEffect(() => {
    setComments(initialComments(analysis, suggestions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey]);

  function persistRoles(next: SigRole[]) {
    setRoles(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const enabledCount = roles.filter((r) => r.enabled && r.label.trim()).length;
  const hasSuggestions = Object.keys(suggestions).length > 0;
  const unreviewed = analysis.quotations.filter((q) => comments[q.id]?.aiSuggested).length;

  async function handleDownload() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const signatureRoles = roles.filter((r) => r.enabled).map((r) => r.label.trim()).filter(Boolean);
      const { generateApprovalFormPdf } = await import('@/lib/approval-form-pdf');
      const blob = await generateApprovalFormPdf(analysis, { signatureRoles, technicalComments: comments });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `technical-approval-form-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('[pdf] approval form generation failed', err);
      setError('Could not generate the PDF. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <CustomizeFormDialog
          analysis={analysis}
          suggestions={suggestions}
          comments={comments}
          onCommentsChange={setComments}
          roles={roles}
          onRolesChange={persistRoles}
          enabledCount={enabledCount}
          unreviewed={unreviewed}
          hasSuggestions={hasSuggestions}
        />
        <button
          type="button"
          onClick={handleDownload}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
          {loading ? 'Generating…' : 'Download Approval Form (PDF)'}
        </button>
      </div>
      {hasSuggestions && unreviewed > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {unreviewed} AI-suggested comment{unreviewed === 1 ? '' : 's'} — review before signing
        </span>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function CustomizeFormDialog({
  analysis,
  suggestions,
  comments,
  onCommentsChange,
  roles,
  onRolesChange,
  enabledCount,
  unreviewed,
  hasSuggestions,
}: {
  analysis: AnalysisResult;
  suggestions: Record<string, TechnicalComment>;
  comments: Record<string, TechnicalComment>;
  onCommentsChange: (next: Record<string, TechnicalComment>) => void;
  roles: SigRole[];
  onRolesChange: (next: SigRole[]) => void;
  enabledCount: number;
  unreviewed: number;
  hasSuggestions: boolean;
}) {
  const setComment = (id: string, text: string) =>
    onCommentsChange({ ...comments, [id]: { text, aiSuggested: false } });
  const resetComment = (id: string) =>
    onCommentsChange({ ...comments, [id]: suggestions[id] ?? { text: '', aiSuggested: false } });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= roles.length) return;
    const next = [...roles];
    [next[i], next[j]] = [next[j], next[i]];
    onRolesChange(next);
  };
  const rename = (i: number, label: string) => onRolesChange(roles.map((r, k) => (k === i ? { ...r, label } : r)));
  const toggle = (i: number) => onRolesChange(roles.map((r, k) => (k === i ? { ...r, enabled: !r.enabled } : r)));
  const remove = (i: number) => onRolesChange(roles.filter((_, k) => k !== i));
  const addRole = () => onRolesChange([...roles, { id: `sig-${Date.now()}`, label: '', enabled: true }]);
  const resetRoles = () => onRolesChange(makeDefaultRoles());

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm transition hover:bg-muted/60 hover:text-foreground"
          title="Review AI-suggested comments and configure signature blocks"
        >
          <Settings2 className="h-4 w-4" />
          Customize form
          {hasSuggestions && unreviewed > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              {unreviewed} to review
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prepare the Technical Approval Form</DialogTitle>
          <DialogDescription>
            Review the AI-suggested Technical Comments (edit or overwrite them — item-match is only a hint, the
            accept/reject decision is yours) and set the signature blocks. Both feed the generated PDF.
          </DialogDescription>
        </DialogHeader>

        {/* ── Technical Comments ── */}
        <section className="mt-1">
          <h3 className="mb-2 text-sm font-semibold">Technical Comments</h3>
          {analysis.quotations.length ? (
            <ul className="space-y-3">
              {analysis.quotations.map((q) => {
                const c = comments[q.id] ?? { text: '', aiSuggested: false };
                return (
                  <li key={q.id} className="rounded-lg border border-border p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{q.supplierName}</span>
                      {c.aiSuggested ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          <Sparkles className="h-3 w-3" /> AI suggested — please review
                        </span>
                      ) : c.text ? (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                          Reviewed
                        </span>
                      ) : null}
                    </div>
                    <textarea
                      value={c.text}
                      onChange={(e) => setComment(q.id, e.target.value)}
                      rows={2}
                      placeholder="e.g. Technically accepted — or — Rejected: supplier has no experience with castable anchor spares"
                      className={cn(
                        'w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary',
                        c.aiSuggested && 'italic text-primary',
                      )}
                    />
                    {suggestions[q.id] && (
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Editing marks it as your own comment. Unreviewed suggestions print with an
                          &ldquo;AI SUGGESTED&rdquo; tag.
                        </span>
                        {!c.aiSuggested && (
                          <button
                            type="button"
                            onClick={() => resetComment(q.id)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          >
                            <RotateCcw className="h-3 w-3" /> Reset to AI suggestion
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No suppliers to comment on yet.</p>
          )}
          {!hasSuggestions && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Upload a company Purchase Requisition to get AI item-match suggestions here.
            </p>
          )}
        </section>

        {/* ── Signature blocks ── */}
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Signature blocks</h3>
            <span className="text-[11px] text-muted-foreground">{enabledCount} enabled</span>
          </div>
          <ul className="space-y-2">
            {roles.map((r, i) => (
              <li
                key={r.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2',
                  r.enabled ? 'border-border bg-card' : 'border-dashed border-border bg-muted/30',
                )}
              >
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() => toggle(i)}
                  aria-label={`Include ${r.label || 'this block'}`}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <input
                  type="text"
                  value={r.label}
                  onChange={(e) => rename(i, e.target.value)}
                  placeholder="Role name (e.g. Electrical Engineer)"
                  className={cn(
                    'min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary',
                    !r.enabled && 'text-muted-foreground',
                  )}
                />
                <div className="flex shrink-0 items-center">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30" aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === roles.length - 1} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30" aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(i)} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${r.label || 'block'}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={resetRoles} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> Reset to default
            </button>
            <button type="button" onClick={addRole} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted/60">
              <Plus className="h-4 w-4" /> Add role
            </button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
