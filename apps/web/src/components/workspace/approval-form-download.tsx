'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
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
import { type AnalysisResult, DEFAULT_SIGNATURE_ROLES } from '@/lib/workspace-types';

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

/**
 * Technical Approval Form download + a dialog to configure the signature blocks
 * (toggle / rename / reorder / add / remove). The form itself carries only the
 * extracted factual data — Technical Comments and the Final Recommendation are
 * left BLANK for the human team to complete and sign; the AI writes no evaluation.
 */
export function ApprovalFormDownload({ analysis }: { analysis: AnalysisResult }) {
  const [roles, setRoles] = useState<SigRole[]>(makeDefaultRoles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRoles(loadRoles()), []);

  function persistRoles(next: SigRole[]) {
    setRoles(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const enabledCount = roles.filter((r) => r.enabled && r.label.trim()).length;

  async function handleDownload() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const signatureRoles = roles.filter((r) => r.enabled).map((r) => r.label.trim()).filter(Boolean);
      const { generateApprovalFormPdf } = await import('@/lib/approval-form-pdf');
      const blob = await generateApprovalFormPdf(analysis, { signatureRoles });
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
        <CustomizeFormDialog roles={roles} onRolesChange={persistRoles} enabledCount={enabledCount} />
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
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function CustomizeFormDialog({
  roles,
  onRolesChange,
  enabledCount,
}: {
  roles: SigRole[];
  onRolesChange: (next: SigRole[]) => void;
  enabledCount: number;
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
          title="Configure the signature blocks on the approval form"
        >
          <Settings2 className="h-4 w-4" />
          Signature blocks
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
            {enabledCount}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Signature blocks</DialogTitle>
          <DialogDescription>
            Configure the approval signature blocks (toggle, rename, reorder, add or remove). Technical Comments and
            the Final Recommendation print blank for the reviewing team to complete and sign.
          </DialogDescription>
        </DialogHeader>

        <section className="mt-1">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Roles</h3>
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
