'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileSpreadsheet,
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
  resolvePrDescription,
  suggestOrigins,
  suggestTechnicalComments,
  suggestWarranties,
} from '@/lib/item-matching';
import { buildComparisonModel } from '@/lib/pr-comparison';
import { useFxRates } from '@/lib/use-fx-rates';
import {
  buildItemReview,
  type CellNoteKind,
  cellEdited,
  cellKey,
  editedCount,
  hasNote,
  isEdited,
  type ItemReview,
  type ItemReviewStore,
  noteCleared,
  noteText,
  type ReviewedCell,
  type ReviewedValue,
  rowKeyOf,
  toStore,
  valueOf,
  withNoteCleared,
} from '@/lib/item-review';
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
const ITEMS_KEY = 'approval:items:v1';
const NAMES_KEY = 'approval:supplierNames:v1';
const PRDESC_KEY = 'approval:prDescription:v1';

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

// ── Header fields the reviewer can rename ──────────────────────────────────
// Supplier names and the PR Description are AI-EXTRACTED from the uploaded
// documents, and extraction gets them wrong often enough to matter: a quote's
// letterhead says "Supply Wave Trading Est." where the company's own records say
// "Supply Wave Trading Establishment", and a requisition's subject line is
// routinely blank or a fragment. Both are printed on a form that gets signed, so
// both are reviewable — with the SAME audit trail as every other reviewed field
// (`{ original, edited }`, badge, reset), and the extracted value never
// overwritten. These are DISPLAY-ONLY: scoring, item matching and the
// recommendation all keep reading the extracted name.
type NameStore = Record<string, string>;

function loadNameStore(key: string, supKey: string): NameStore {
  if (typeof window === 'undefined') return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    const forKey = all?.[supKey];
    return forKey && typeof forKey === 'object' ? forKey : {};
  } catch {
    return {};
  }
}
function saveNameStore(key: string, supKey: string, store: NameStore) {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    all[supKey] = store;
    window.localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Reviewed `{ original, edited }` values keyed by id, persisted per analysis. */
function useReviewedNames(originals: Record<string, string>, storageKey: string, supKey: string) {
  const build = (edits: NameStore): Record<string, ReviewedValue> => {
    const out: Record<string, ReviewedValue> = {};
    for (const [id, original] of Object.entries(originals)) {
      out[id] = { original, edited: typeof edits[id] === 'string' ? edits[id] : null };
    }
    return out;
  };
  const [values, setValues] = useState<Record<string, ReviewedValue>>(() => build(loadNameStore(storageKey, supKey)));
  // Re-seed when the analysed suppliers change (or on reload) — overlay persisted edits.
  useEffect(() => {
    setValues(build(loadNameStore(storageKey, supKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey, JSON.stringify(originals)]);

  const edit = (id: string, text: string) => {
    setValues((prev) => ({ ...prev, [id]: { original: prev[id]?.original ?? '', edited: text } }));
    const store = loadNameStore(storageKey, supKey);
    store[id] = text;
    saveNameStore(storageKey, supKey, store);
  };
  const reset = (id: string) => {
    setValues((prev) => ({ ...prev, [id]: { original: prev[id]?.original ?? '', edited: null } }));
    const store = loadNameStore(storageKey, supKey);
    delete store[id];
    saveNameStore(storageKey, supKey, store);
  };
  return { values, edit, reset };
}
type ReviewedNamesApi = ReturnType<typeof useReviewedNames>;

// ── Comparison Table review ────────────────────────────────────────────────
// Same audit-trail pattern as the Technical Comments, applied per FIELD: the
// extracted original is kept beside the reviewer's edit, the badge says which one
// the form will print, and "Reset to AI suggestion" restores the original.
// Reviewer edits change the FORM only — scoring stays on the extracted values.
function useItemReview(analysis: AnalysisResult, supKey: string) {
  const fx = useFxRates();
  // The grid exactly as the form builds it: anchored to the PR's line items.
  const model = useMemo(
    () =>
      buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, {
        prOnly: true,
        fx,
      }),
    [analysis, fx],
  );
  const [review, setReview] = useState<ItemReview>(() =>
    buildItemReview(model, analysis.quotations, loadFieldStore(ITEMS_KEY, supKey) as ItemReviewStore),
  );
  // Re-seed when the analysed suppliers change (or on reload) — overlay persisted edits.
  useEffect(() => {
    setReview(buildItemReview(model, analysis.quotations, loadFieldStore(ITEMS_KEY, supKey) as ItemReviewStore));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supKey, model]);

  const commit = (next: ItemReview) => {
    setReview(next);
    saveFieldStore(ITEMS_KEY, supKey, toStore(next) as FieldStore);
  };
  const patch = (key: string, fn: (c: ReviewedCell) => ReviewedCell) => {
    const cur = review[key];
    if (!cur) return;
    commit({ ...review, [key]: fn(cur) });
  };

  return {
    fx,
    model,
    review,
    /** A human edit to one field — the original is kept for the audit trail. */
    edit: (key: string, field: 'description' | 'qty' | 'unitPrice', text: string) =>
      patch(key, (c) => ({ ...c, [field]: { ...c[field], edited: text } })),
    /** Restore one field to the extracted value. */
    reset: (key: string, field: 'description' | 'qty' | 'unitPrice') =>
      patch(key, (c) => ({ ...c, [field]: { ...c[field], edited: null } })),
    /** Restore every field of a cell (and re-arm its spec-differs flag). */
    resetCell: (key: string) =>
      patch(key, (c) => ({
        ...c,
        description: { ...c.description, edited: null },
        qty: { ...c.qty, edited: null },
        unitPrice: { ...c.unitPrice, edited: null },
        specDiffCleared: false,
        unitWarningCleared: false,
        added: false,
      })),
    /** Show / hide ONE annotation note on ONE cell. */
    setNoteCleared: (key: string, kind: CellNoteKind, cleared: boolean) =>
      patch(key, (c) => withNoteCleared(c, kind, cleared)),
    /**
     * Show / hide one kind of note across EVERY cell of one supplier's column in a
     * single click — the notes are stored per line-item-per-supplier, so hiding a
     * supplier's "spec differs" annotations otherwise meant opening each item row
     * and clicking it once per row.
     */
    setSupplierNotesCleared: (quotationId: string, kind: CellNoteKind, cleared: boolean) => {
      const next = { ...review };
      let changed = false;
      for (const [k, c] of Object.entries(review)) {
        if (c.quotationId !== quotationId || !hasNote(c, kind)) continue;
        if (noteCleared(c, kind) === cleared) continue;
        next[k] = withNoteCleared(c, kind, cleared);
        changed = true;
      }
      if (changed) commit(next);
    },
    /** Deliberately turn a "Not Quoted" row into a quoted one (never implicit). */
    addQuotedLine: (key: string, add: boolean) => patch(key, (c) => ({ ...c, added: add })),
  };
}
type ItemReviewApi = ReturnType<typeof useItemReview>;

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
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [xlsxError, setXlsxError] = useState<string | null>(null);

  const supKey = analysis.quotations.map((q) => q.id).join('|');
  const suggestions = useMemo(
    () => suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition, analysis.quotations),
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

  // The comparison table itself — every description / qty / unit price the form
  // prints is reviewable before it goes into the PDF.
  const items = useItemReview(analysis, supKey);

  // Header fields extraction gets wrong often enough to be worth reviewing.
  const supplierNameAi = useMemo(
    () => Object.fromEntries(analysis.quotations.map((q) => [q.id, q.supplierName ?? ''])),
    [analysis],
  );
  const prDescriptionAi = useMemo(
    () => ({ pr: resolvePrDescription(analysis.purchaseRequisition) }),
    [analysis],
  );
  const supplierNames = useReviewedNames(supplierNameAi, NAMES_KEY, supKey);
  const prDescription = useReviewedNames(prDescriptionAi, PRDESC_KEY, supKey);

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
      // react-pdf renders the LAYOUT (the buyer's reference form); the overlay then
      // loads those bytes and lays editable AcroForm fields over the measured cells.
      const { generateApprovalFormPdf } = await import('@/lib/approval-form');
      const blob = await generateApprovalFormPdf(analysis, {
        signatureRoles,
        technicalComments: comments,
        warranties: warranty.values,
        countriesOfOrigin: origin.values,
        selectedSupplier,
        // The reviewer's corrections to the grid — the form prints these, falling
        // back to the extracted value wherever they left a field untouched.
        itemReview: items.review,
        supplierNames: supplierNames.values,
        prDescription: prDescription.values.pr,
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

  // Same form, same Customize state, as an .xlsx — Farid wants both formats from
  // one review pass. ExcelJS needs Node, so this one round-trips through an API
  // route (the tender sheet's export does the same) rather than generating
  // client-side like the PDF; the analysis + every Customize option travel in the
  // body so the download matches exactly what is on screen, unsaved edits
  // included. The fx rate is `items.fx` — the SAME rate already used to build the
  // on-screen comparison table and its totals — rather than a fresh server-side
  // fetch, so the workbook's numbers cannot disagree with what the reviewer saw.
  async function handleDownloadExcel() {
    if (xlsxLoading) return;
    setXlsxError(null);
    setXlsxLoading(true);
    try {
      const signatureRoles = roles.filter((r) => r.enabled).map((r) => r.label.trim()).filter(Boolean);
      const res = await fetch('/api/ta-form/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          options: {
            signatureRoles,
            technicalComments: comments,
            warranties: warranty.values,
            countriesOfOrigin: origin.values,
            selectedSupplier,
            itemReview: items.review,
            supplierNames: supplierNames.values,
            prDescription: prDescription.values.pr,
          },
          fx: items.fx,
        }),
      });
      if (!res.ok) {
        throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `technical-approval-form-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('[xlsx] approval form export failed', err);
      setXlsxError((err as Error).message || 'Could not generate the Excel file. Please try again.');
    } finally {
      setXlsxLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <CustomizeFormDialog
          analysis={analysis}
          items={items}
          supplierNames={supplierNames}
          prDescription={prDescription}
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
        <button
          type="button"
          onClick={handleDownloadExcel}
          disabled={xlsxLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {xlsxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          {xlsxLoading ? 'Generating…' : 'Download TA Form (.xlsx)'}
        </button>
      </div>
      {/* A form built from a stale restored analysis leaves the app and gets
          signed — the warning has to travel with the button, not just sit at the
          top of the page. */}
      {analysis.stale && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
          <AlertTriangle className="h-3 w-3" />
          Built from an out-of-date analysis — re-run before signing
        </span>
      )}
      {hasSuggestions && unreviewed > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {unreviewed} AI-suggested comment{unreviewed === 1 ? '' : 's'} — review before signing
        </span>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
      {xlsxError && <span className="text-xs text-danger">{xlsxError}</span>}
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
// One reviewable field, styled exactly like a Technical Comment: the badge says
// whether the form will print the AI/extracted value or the reviewer's, and
// "Reset to AI suggestion" puts the original back.
function ReviewField({
  label,
  value,
  suffix,
  placeholder,
  onEdit,
  onReset,
}: {
  label: string;
  value: ReviewedValue;
  /** e.g. the supplier's own currency next to the unit price */
  suffix?: string;
  placeholder?: string;
  onEdit: (text: string) => void;
  onReset: () => void;
}) {
  const edited = isEdited(value);
  const hasOriginal = value.original.trim() !== '';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {label}
          {suffix ? <span className="ml-1 font-semibold text-foreground">{suffix}</span> : null}
        </span>
        {edited ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
            Your value
          </span>
        ) : hasOriginal ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" /> AI suggested — please review
          </span>
        ) : null}
      </div>
      <input
        type="text"
        value={valueOf(value)}
        onChange={(e) => onEdit(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary',
          !edited && hasOriginal && 'italic text-primary',
        )}
      />
      {edited && hasOriginal && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-muted-foreground" title={value.original}>
            Extracted: {value.original}
          </span>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Reset to AI suggestion
          </button>
        </div>
      )}
    </div>
  );
}

// Every annotation the form can print in orange under a supplier's item
// description. Each is a separate factual finding, so each gets its own toggle.
const NOTE_KINDS: { kind: CellNoteKind; label: string; hint: string }[] = [
  {
    kind: 'specDiff',
    label: 'spec differs',
    hint: 'the supplier quoted a different grade / size than the PR asked for',
  },
  {
    kind: 'unitWarning',
    label: 'unit warning',
    hint: 'the supplier’s unit could not be converted to the PR’s unit, so the figures are shown as quoted',
  },
];

// One show/hide pill for one annotation note. Shown = the form prints it.
function NoteToggle({
  label,
  note,
  cleared,
  onToggle,
  count,
}: {
  label: string;
  note?: string | null;
  cleared: boolean;
  onToggle: () => void;
  /** how many cells this pill covers, when it is a whole-column toggle */
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!cleared}
      title={
        cleared
          ? `Hidden on the form — click to show the "${label}" note again`
          : `Shown on the form${note ? `: ${note}` : ''} — click to hide it`
      }
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition',
        cleared
          ? 'border-border text-muted-foreground hover:bg-muted'
          : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15',
      )}
    >
      {cleared ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      {label}
      {count != null && <span className="opacity-70">({count})</span>}
    </button>
  );
}

/**
 * Item notes, grouped BY SUPPLIER COLUMN — the control the reviewer actually wants.
 *
 * The notes themselves live per line-item-per-supplier (one flag on each cell of
 * the comparison grid), so a supplier with four flagged rows had four separate
 * toggles, each buried inside its own collapsed item row in the Comparison Table
 * above. That is why toggling "the Supply Wave one" left the note printed: it hid
 * exactly one of several. This section lists every supplier that carries notes and
 * gives each a single Show all / Hide all per note kind, with the per-row toggles
 * still available underneath for a mixed choice.
 */
function ItemNotesSection({ items }: { items: ItemReviewApi }) {
  const { model, review } = items;
  // Which (supplier × note kind) combinations actually exist in the data?
  const bySupplier = model.suppliers
    .map((sup) => {
      const cells = Object.entries(review)
        .filter(([, c]) => c.quotationId === sup.quotationId)
        .sort((a, b) => a[1].rowIndex - b[1].rowIndex);
      const kinds = NOTE_KINDS.map(({ kind, label, hint }) => {
        const withNote = cells.filter(([, c]) => hasNote(c, kind));
        const shown = withNote.filter(([, c]) => !noteCleared(c, kind)).length;
        return { kind, label, hint, cells: withNote, shown };
      }).filter((k) => k.cells.length > 0);
      return { sup, kinds };
    })
    .filter((s) => s.kinds.length > 0);

  if (!bySupplier.length) return null;

  return (
    <section className="mt-6">
      <h3 className="mb-1 text-sm font-semibold">Item notes</h3>
      <p className="mb-2 text-[11px] text-muted-foreground">
        The orange notes the form prints under a supplier&apos;s item description. They are the matcher&apos;s factual
        findings, recorded per item per supplier — hide them per supplier column, or per item below. Hiding a note only
        removes it from the form: the extracted data, the scoring and every printed figure are unchanged.
      </p>
      <ul className="space-y-3">
        {bySupplier.map(({ sup, kinds }) => (
          <li key={sup.quotationId} className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-semibold">{sup.supplier}</div>
            <ul className="space-y-2.5">
              {kinds.map(({ kind, label, hint, cells, shown }) => (
                <li key={kind}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{label}</span> — {hint} · on {cells.length} item
                      {cells.length === 1 ? '' : 's'}, {shown} shown
                    </span>
                    <NoteToggle
                      label={shown > 0 ? `Hide all` : `Show all`}
                      cleared={shown === 0}
                      count={cells.length}
                      onToggle={() => items.setSupplierNotesCleared(sup.quotationId, kind, shown > 0)}
                    />
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {cells.map(([key, c]) => (
                      <li key={key} className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1">
                        <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={noteText(c, kind) ?? ''}>
                          <span className="font-medium text-foreground">{c.isCharge ? c.rowLabel : `Item ${c.rowIndex}`}</span>
                          {noteText(c, kind) ? ` — ${noteText(c, kind)}` : ''}
                        </span>
                        <NoteToggle
                          label={noteCleared(c, kind) ? 'Hidden' : 'Shown'}
                          note={noteText(c, kind)}
                          cleared={noteCleared(c, kind)}
                          onToggle={() => items.setNoteCleared(key, kind, !noteCleared(c, kind))}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The comparison grid the form prints, made editable one PR item row at a time.
function ComparisonTableSection({ items }: { items: ItemReviewApi }) {
  const { model, review, fx } = items;
  if (!model.suppliers.length || !model.rows.length) return null;
  const edits = editedCount(review);

  return (
    <section className="mt-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Comparison Table</h3>
        {edits > 0 && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
            {edits} cell{edits === 1 ? '' : 's'} edited
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Correct what the form prints — the item description, quantity and unit price each supplier quoted. The unit
        price is edited in the supplier&apos;s own quoted currency; SAR / USD on the form are recalculated from it at the
        live rate{fx ? '' : ' (unavailable right now — amounts stay in the original currency)'}. Totals recompute from
        your figures. Scoring and the recommendation are unaffected — they always use the extracted values.
      </p>
      <ul className="space-y-2">
        {model.rows.map((row) => {
          const rowKey = rowKeyOf(row);
          const touched = model.suppliers.filter((s) => cellEdited(review[cellKey(rowKey, s.quotationId)] ?? ({} as ReviewedCell))).length;
          return (
            <li key={rowKey} className="rounded-lg border border-border">
              <details>
                <summary className="cursor-pointer list-none px-3 py-2 text-sm">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {row.kind === 'charge' ? row.label : `${row.index}. ${row.label}`}
                      </span>
                      {row.qty != null && (
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          · PR qty {row.qty.toLocaleString('en-US')} {row.uom ?? ''}
                        </span>
                      )}
                    </span>
                    {touched > 0 && (
                      <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                        {touched} edited
                      </span>
                    )}
                  </span>
                </summary>
                <ul className="space-y-3 border-t border-border p-3">
                  {model.suppliers.map((sup) => {
                    const key = cellKey(rowKey, sup.quotationId);
                    const c = review[key];
                    if (!c) return null;
                    const notQuoted = !c.quoted && !c.added;
                    return (
                      <li key={sup.quotationId} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{sup.supplier}</span>
                          <div className="flex items-center gap-2">
                            {/* The matcher's findings survive an edit — only an explicit clear removes one. */}
                            {NOTE_KINDS.map(({ kind, label }) =>
                              hasNote(c, kind) ? (
                                <NoteToggle
                                  key={kind}
                                  label={label}
                                  note={noteText(c, kind)}
                                  cleared={noteCleared(c, kind)}
                                  onToggle={() => items.setNoteCleared(key, kind, !noteCleared(c, kind))}
                                />
                              ) : null,
                            )}
                            {cellEdited(c) && (
                              <button
                                type="button"
                                onClick={() => items.resetCell(key)}
                                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              >
                                <RotateCcw className="h-3 w-3" /> Reset row
                              </button>
                            )}
                          </div>
                        </div>

                        {notQuoted ? (
                          // Editing must never silently turn "Not Quoted" into a quote.
                          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-2">
                            <span className="text-[11px] italic text-muted-foreground">
                              Not Quoted — this supplier did not quote this item.
                            </span>
                            <button
                              type="button"
                              onClick={() => items.addQuotedLine(key, true)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" /> Add a quoted line
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <ReviewField
                              label="Item description"
                              value={c.description}
                              placeholder="the supplier's own quoted description"
                              onEdit={(t) => items.edit(key, 'description', t)}
                              onReset={() => items.reset(key, 'description')}
                            />
                            <div className="grid grid-cols-2 gap-2.5">
                              <ReviewField
                                label="Quantity"
                                value={c.qty}
                                placeholder="e.g. 10,000"
                                onEdit={(t) => items.edit(key, 'qty', t)}
                                onReset={() => items.reset(key, 'qty')}
                              />
                              <ReviewField
                                label="Unit price"
                                suffix={c.currency}
                                value={c.unitPrice}
                                placeholder="e.g. 2.42"
                                onEdit={(t) => items.edit(key, 'unitPrice', t)}
                                onReset={() => items.reset(key, 'unitPrice')}
                              />
                            </div>
                            {c.added && !c.quoted && (
                              <div className="flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => items.addQuotedLine(key, false)}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                >
                                  <Trash2 className="h-3 w-3" /> Back to &ldquo;Not Quoted&rdquo;
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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

// The form's header identity: the PR subject line and each supplier's printed
// name, both AI-extracted and both routinely wrong in small ways that matter on a
// signed document. Same pattern as Warranty / Country of Origin.
function HeaderFieldsSection({
  quotations,
  supplierNames,
  prDescription,
}: {
  quotations: AnalysisResult['quotations'];
  supplierNames: ReviewedNamesApi;
  prDescription: ReviewedNamesApi;
}) {
  const prValue = prDescription.values.pr;
  return (
    <section className="mt-6">
      <h3 className="mb-1 text-sm font-semibold">Form header &amp; supplier names</h3>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Extracted from the requisition and the quotes. Correct anything that reads wrong — the form prints your version;
        the extracted value is kept beside it and one click restores it. Renaming a supplier changes the printed column
        heading only: matching, scoring and the recommendation all keep using the extracted name.
      </p>
      <div className="space-y-3">
        {prValue && (
          <div className="rounded-lg border border-border p-3">
            <ReviewField
              label="PR Description"
              value={prValue}
              placeholder="e.g. Anchors for Kiln department"
              onEdit={(t) => prDescription.edit('pr', t)}
              onReset={() => prDescription.reset('pr')}
            />
          </div>
        )}
        {quotations.map((q) => {
          const v = supplierNames.values[q.id];
          if (!v) return null;
          return (
            <div key={q.id} className="rounded-lg border border-border p-3">
              <ReviewField
                label="Supplier name"
                value={v}
                placeholder="the supplier's full legal name"
                onEdit={(t) => supplierNames.edit(q.id, t)}
                onReset={() => supplierNames.reset(q.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CustomizeFormDialog({
  analysis,
  items,
  supplierNames,
  prDescription,
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
  items: ItemReviewApi;
  supplierNames: ReviewedNamesApi;
  prDescription: ReviewedNamesApi;
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

        {/* ── Form header & supplier names (editable, AI-extracted) ── */}
        <HeaderFieldsSection
          quotations={analysis.quotations}
          supplierNames={supplierNames}
          prDescription={prDescription}
        />

        {/* ── Comparison Table (edit the line-item data the form prints) ── */}
        <ComparisonTableSection items={items} />

        {/* ── Item notes (show/hide the orange annotations, per supplier column) ── */}
        <ItemNotesSection items={items} />

        {/* ── Technical Comments ── */}
        <section className="mt-6">
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
