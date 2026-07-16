'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { cn, isChunkLoadError, STALE_BUILD_MESSAGE } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  buildApprovalFields,
  suggestOrigins,
  suggestTechnicalComments,
  suggestWarranties,
} from '@/lib/item-matching';
import {
  type AnalysisResult,
  type ApprovalFieldValue,
  DEFAULT_SIGNATURE_ROLES,
  type TechnicalComment,
} from '@/lib/workspace-types';

interface SigRole {
  id: string;
  label: string;
  enabled: boolean;
}

const ROLES_KEY = 'approval:signatureRoles';
const COMMENTS_KEY = 'approval:comments:v1';
const WARRANTY_KEY = 'approval:warranty:v1';
const ORIGIN_KEY = 'approval:origin:v1';

// A persisted per-supplier override for a toggleable field: `enabled` overrides the
// default-ON toggle; a `text` string (incl. "") is the human's edit/clear. Absent
// keys fall back to the fresh AI value. Stored per analysis (keyed by supplier set).
type FieldOverride = { enabled?: boolean; text?: string | null };
type FieldStore = Record<string, FieldOverride>;

function loadFieldStore(key: string, supKey: string): FieldStore {
  if (typeof window === 'undefined') return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    const forKey = all?.[supKey];
    return forKey && typeof forKey === 'object' ? forKey : {};
  } catch {
    return {};
  }
}
function saveFieldStore(key: string, supKey: string, store: FieldStore) {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    all[supKey] = store;
    window.localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

const makeDefaultRoles = (): SigRole[] =>
  DEFAULT_SIGNATURE_ROLES.map((label, i) => ({ id: `sig-${i}-${label}`, label, enabled: true }));

function loadRoles(): SigRole[] {
  if (typeof window === 'undefined') return makeDefaultRoles();
  try {
    const raw = window.localStorage.getItem(ROLES_KEY);
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

// Human-edited comments persist per analysis (keyed by its supplier-id set) so they
// survive regeneration/reload. Only HUMAN edits are stored — AI suggestions are
// always recomputed fresh, then human edits are overlaid on top.
function loadHumanEdits(supKey: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(COMMENTS_KEY) ?? '{}');
    const forKey = all?.[supKey];
    return forKey && typeof forKey === 'object' ? forKey : {};
  } catch {
    return {};
  }
}
function saveHumanEdits(supKey: string, edits: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(COMMENTS_KEY) ?? '{}');
    all[supKey] = edits;
    window.localStorage.setItem(COMMENTS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// A per-supplier toggleable field (Warranty, Country of Origin): AI pre-fills the
// value; the human can edit, clear, or hide it per supplier; toggles + edits
// persist per analysis and are overlaid on the fresh AI values. Mirrors the
// Technical Comments pattern, plus an on/off switch.
function useToggleableField(
  analysis: AnalysisResult,
  aiText: Record<string, string>,
  storageKey: string,
  supKey: string,
) {
  const [values, setValues] = useState<Record<string, ApprovalFieldValue>>(() =>
    buildApprovalFields(analysis.quotations, aiText, loadFieldStore(storageKey, supKey)),
  );
  // Re-seed when the analysed suppliers change (or on reload) — overlay persisted edits.
  useEffect(() => {
    setValues(buildApprovalFields(analysis.quotations, aiText, loadFieldStore(storageKey, supKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey]);

  // A human edit (or clear) → plain value, drops the AI tag, persisted.
  const edit = (id: string, text: string) => {
    setValues((prev) => ({ ...prev, [id]: { enabled: prev[id]?.enabled ?? true, text, aiSuggested: false } }));
    const store = loadFieldStore(storageKey, supKey);
    store[id] = { ...store[id], text };
    saveFieldStore(storageKey, supKey, store);
  };
  // Show/hide this field for this supplier — HIDES on the form, never deletes data.
  const toggle = (id: string) => {
    const nextEnabled = !(values[id]?.enabled ?? true);
    setValues((prev) => {
      const cur = prev[id] ?? { text: aiText[id] ?? '', aiSuggested: (aiText[id] ?? '').trim() !== '' };
      return { ...prev, [id]: { ...cur, enabled: nextEnabled } };
    });
    const store = loadFieldStore(storageKey, supKey);
    store[id] = { ...store[id], enabled: nextEnabled };
    saveFieldStore(storageKey, supKey, store);
  };
  // Reset the VALUE back to the AI suggestion (keeps the show/hide state).
  const reset = (id: string) => {
    const ai = aiText[id] ?? '';
    setValues((prev) => ({
      ...prev,
      [id]: { enabled: prev[id]?.enabled ?? true, text: ai, aiSuggested: ai.trim() !== '' },
    }));
    const store = loadFieldStore(storageKey, supKey);
    if (store[id]) {
      delete store[id].text;
      if (store[id].enabled === undefined) delete store[id];
    }
    saveFieldStore(storageKey, supKey, store);
  };

  return { values, edit, toggle, reset };
}

// AI suggestion for each supplier, with any persisted HUMAN edit overlaid (a human
// edit becomes a plain, non-AI comment).
function buildComments(
  analysis: AnalysisResult,
  suggestions: Record<string, TechnicalComment>,
  humanEdits: Record<string, string>,
): Record<string, TechnicalComment> {
  const out: Record<string, TechnicalComment> = {};
  for (const q of analysis.quotations) {
    if (typeof humanEdits[q.id] === 'string') {
      out[q.id] = { text: humanEdits[q.id], aiSuggested: false };
    } else {
      out[q.id] = suggestions[q.id] ?? { text: '', aiSuggested: false };
    }
  }
  return out;
}

/**
 * Technical Approval Form download + a dialog to review/edit the AI-SUGGESTED
 * Technical Comments per supplier and configure the signature blocks. AI verdicts
 * are marked and editable; editing one drops the "AI SUGGESTED:" tag and persists
 * it as the human's own comment. The Final Recommendation is never AI-written.
 */
export function ApprovalFormDownload({
  analysis,
  selectedSupplier = null,
}: {
  analysis: AnalysisResult;
  /** the human's chosen supplier — printed in the Final Recommendation area */
  selectedSupplier?: string | null;
}) {
  const [roles, setRoles] = useState<SigRole[]>(makeDefaultRoles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supKey = analysis.quotations.map((q) => q.id).join('|');
  const suggestions = useMemo(
    () => suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition),
    [analysis],
  );
  const [comments, setComments] = useState<Record<string, TechnicalComment>>(() =>
    buildComments(analysis, suggestions, {}),
  );

  // Per-supplier, toggleable Warranty + Country of Origin (AI-prefilled, editable).
  const warrantyAi = useMemo(() => suggestWarranties(analysis.quotations), [analysis]);
  const originAi = useMemo(() => suggestOrigins(analysis.quotations), [analysis]);
  const warranty = useToggleableField(analysis, warrantyAi, WARRANTY_KEY, supKey);
  const origin = useToggleableField(analysis, originAi, ORIGIN_KEY, supKey);

  useEffect(() => setRoles(loadRoles()), []);
  // Re-seed when the analysed suppliers change (or on reload) — overlay persisted edits.
  useEffect(() => {
    setComments(buildComments(analysis, suggestions, loadHumanEdits(supKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey]);

  function persistRoles(next: SigRole[]) {
    setRoles(next);
    try {
      window.localStorage.setItem(ROLES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // A human edit → plain comment (drops the AI tag) and is persisted.
  function editComment(id: string, text: string) {
    setComments((prev) => ({ ...prev, [id]: { text, aiSuggested: false } }));
    const edits = loadHumanEdits(supKey);
    edits[id] = text;
    saveHumanEdits(supKey, edits);
  }
  // Reset back to the AI suggestion and forget the persisted human edit.
  function resetComment(id: string) {
    setComments((prev) => ({ ...prev, [id]: suggestions[id] ?? { text: '', aiSuggested: false } }));
    const edits = loadHumanEdits(supKey);
    delete edits[id];
    saveHumanEdits(supKey, edits);
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
      const { generateApprovalFormPdf } = await import('@/lib/approval-form-acroform');
      const blob = await generateApprovalFormPdf(analysis, {
        signatureRoles,
        technicalComments: comments,
        warranties: warranty.values,
        countriesOfOrigin: origin.values,
        selectedSupplier,
      });
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
      setError(isChunkLoadError(err) ? STALE_BUILD_MESSAGE : 'Could not generate the PDF. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <CustomizeFormDialog
          analysis={analysis}
          comments={comments}
          suggestions={suggestions}
          onEdit={editComment}
          onReset={resetComment}
          warranty={warranty}
          warrantyAi={warrantyAi}
          origin={origin}
          originAi={originAi}
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

interface ToggleableField {
  values: Record<string, ApprovalFieldValue>;
  edit: (id: string, text: string) => void;
  toggle: (id: string) => void;
  reset: (id: string) => void;
}

// A per-supplier, individually toggleable Approval Form field (Warranty, Country of
// Origin). Same edit/reset/AI-label behaviour as Technical Comments, plus a
// per-supplier show/hide switch. Turning a supplier OFF hides the field on the
// generated form (it does NOT delete the underlying extracted value).
function ToggleableFieldSection({
  title,
  hint,
  quotations,
  field,
  aiText,
  placeholder,
}: {
  title: string;
  hint: string;
  quotations: AnalysisResult['quotations'];
  field: ToggleableField;
  aiText: Record<string, string>;
  placeholder: string;
}) {
  if (!quotations.length) return null;
  return (
    <section className="mt-6">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="mb-2 text-[11px] text-muted-foreground">{hint}</p>
      <ul className="space-y-3">
        {quotations.map((q) => {
          const f = field.values[q.id] ?? { enabled: true, text: '', aiSuggested: false };
          const hasAi = (aiText[q.id] ?? '').trim() !== '';
          return (
            <li
              key={q.id}
              className={cn(
                'rounded-lg border p-3',
                f.enabled ? 'border-border' : 'border-dashed border-border bg-muted/30',
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={cn('text-sm font-semibold', !f.enabled && 'text-muted-foreground')}>
                  {q.supplierName}
                </span>
                <div className="flex items-center gap-2">
                  {f.enabled && f.aiSuggested ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      <Sparkles className="h-3 w-3" /> AI suggested — please review
                    </span>
                  ) : f.enabled && f.text.trim() ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                      Your value
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => field.toggle(q.id)}
                    aria-pressed={f.enabled}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
                      f.enabled
                        ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    title={f.enabled ? `Shown on the form — click to hide ${title} for ${q.supplierName}` : `Hidden — click to show ${title} for ${q.supplierName}`}
                  >
                    {f.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {f.enabled ? 'Shown' : 'Hidden'}
                  </button>
                </div>
              </div>
              {f.enabled && (
                <>
                  <input
                    type="text"
                    value={f.text}
                    onChange={(e) => field.edit(q.id, e.target.value)}
                    placeholder={placeholder}
                    className={cn(
                      'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary',
                      f.aiSuggested && 'italic text-primary',
                    )}
                  />
                  {hasAi && !f.aiSuggested && (
                    <div className="mt-1.5 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => field.reset(q.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" /> Reset to AI suggestion
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CustomizeFormDialog({
  analysis,
  comments,
  suggestions,
  onEdit,
  onReset,
  warranty,
  warrantyAi,
  origin,
  originAi,
  roles,
  onRolesChange,
  enabledCount,
  unreviewed,
  hasSuggestions,
}: {
  analysis: AnalysisResult;
  comments: Record<string, TechnicalComment>;
  suggestions: Record<string, TechnicalComment>;
  onEdit: (id: string, text: string) => void;
  onReset: (id: string) => void;
  warranty: ToggleableField;
  warrantyAi: Record<string, string>;
  origin: ToggleableField;
  originAi: Record<string, string>;
  roles: SigRole[];
  onRolesChange: (next: SigRole[]) => void;
  enabledCount: number;
  unreviewed: number;
  hasSuggestions: boolean;
}) {
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
          title="Review AI-suggested Technical Comments and configure signature blocks"
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
            Review the AI-suggested Technical Comments (edit to overwrite — the verdict is based only on item/spec
            matching vs the PR; the accept/reject decision is yours) and set the signature blocks. The Final
            Recommendation always prints blank.
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
                          Your comment
                        </span>
                      ) : null}
                    </div>
                    <textarea
                      value={c.text}
                      onChange={(e) => onEdit(q.id, e.target.value)}
                      rows={2}
                      placeholder="e.g. Technically Accepted — or your own note"
                      className={cn(
                        'w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary',
                        c.aiSuggested && 'italic text-primary',
                      )}
                    />
                    {suggestions[q.id] && !c.aiSuggested && (
                      <div className="mt-1.5 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => onReset(q.id)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" /> Reset to AI suggestion
                        </button>
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
              Upload a company Purchase Requisition to get AI item-match verdicts here.
            </p>
          )}
        </section>

        {/* ── Country of Origin (per-supplier, toggleable) ── */}
        <ToggleableFieldSection
          title="Country of Origin"
          hint="AI-prefilled from each quote (local Saudi suppliers → Saudi Arabia). Edit or clear per supplier; turn a supplier off to hide it on the form. Hiding never changes the VAT local/international rule."
          quotations={analysis.quotations}
          field={origin}
          aiText={originAi}
          placeholder="e.g. Saudi Arabia"
        />

        {/* ── Warranty (per-supplier, toggleable) ── */}
        <ToggleableFieldSection
          title="Warranty"
          hint={'AI-prefilled from each quote ("Not stated" when the quote states none — never invented). Edit or clear per supplier; turn a supplier off to hide the Warranty row.'}
          quotations={analysis.quotations}
          field={warranty}
          aiText={warrantyAi}
          placeholder="e.g. 12 months against manufacturing defects"
        />

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
