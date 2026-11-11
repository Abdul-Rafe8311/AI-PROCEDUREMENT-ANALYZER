'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-fetch';
import {
  ALREADY_DECIDED_TEXT,
  EMAIL_NOT_SENT,
  EMPTY_QUEUE,
  REASON_HINT,
  approveSummary,
  decidedLine,
  duplicateWarningLead,
  interpretDecision,
  planName,
  receiptAlt,
  rejectDisabled,
  submittedLabel,
  usd,
  who,
} from '@/lib/admin-queue';
import { pageCount, statusBadge } from '@/lib/payment-form';
import type { AdminPaymentDto, AdminPaymentsHistory, AdminPaymentsPending } from '@/lib/payments-types';

// ---- receipt (signed URL, fetched on demand; it expires after 60 s) ----

async function fetchReceiptUrl(id: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/payments/${id}/screenshot`);
    if (!res.ok) return null;
    const b = (await res.json()) as { url?: string };
    return b.url ?? null;
  } catch {
    return null;
  }
}

function ReceiptThumb({ p, onOpen }: { p: AdminPaymentDto; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (p.hasScreenshot && p.receiptType === 'image') {
      void fetchReceiptUrl(p.id).then((u) => {
        if (!alive) return;
        if (u) setUrl(u);
        else setFailed(true);
      });
    }
    return () => {
      alive = false;
    };
  }, [p.id, p.hasScreenshot, p.receiptType]);

  if (!p.hasScreenshot) return <p className="text-sm text-muted-foreground">No receipt stored.</p>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open receipt submitted by ${who(p)}`}
      className="flex min-h-[44px] w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
    >
      {p.receiptType === 'image' && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={receiptAlt(p)} className="max-h-48 w-full object-contain" />
      ) : (
        <span className="px-4 py-8 text-sm text-muted-foreground">
          {p.receiptType === 'pdf' ? 'PDF receipt. Tap to open.' : failed ? 'Could not load the receipt. Tap to retry.' : 'Loading receipt…'}
        </span>
      )}
    </button>
  );
}

function ReceiptViewer({ p, open, onClose }: { p: AdminPaymentDto; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setUrl(null);
    setFailed(false);
    setZoom(1);
    void fetchReceiptUrl(p.id).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [open, p.id]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[100dvh] max-w-none gap-3 overflow-hidden rounded-none p-3 sm:h-[90vh] sm:max-w-4xl sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
          <DialogDescription>{receiptAlt(p)}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          {p.receiptType === 'image' && (
            <>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out">
                <ZoomOut className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in">
                <ZoomIn className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
          {url && (
            <Button asChild variant="outline" className="min-h-[44px]">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden /> Open in new tab
              </a>
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/40" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
          {failed && <p className="p-6 text-sm text-muted-foreground">Could not load the receipt. Close and try again.</p>}
          {!url && !failed && <Skeleton className="h-64 w-full" />}
          {url && p.receiptType === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={receiptAlt(p)} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="mx-auto block" />
          )}
          {url && p.receiptType === 'pdf' && (
            <p className="p-6 text-sm">This receipt is a PDF. Use &ldquo;Open in new tab&rdquo; to read it.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- decision dialog (Dialog on md+, bottom sheet below md) ----

type Mode = 'approve' | 'reject';

function DecisionSheet({
  p,
  mode,
  onClose,
  onDecided,
}: {
  p: AdminPaymentDto;
  mode: Mode | null;
  onClose: () => void;
  onDecided: (p: AdminPaymentDto, mode: Mode, message: string, warn: boolean, stale: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (mode) {
      setReason('');
      setError(null);
    }
  }, [mode, p.id]);

  async function confirm() {
    if (!mode || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/payments/${p.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: mode, ...(mode === 'reject' ? { reason: reason.trim() } : {}) }),
      });
      const out = interpretDecision(res.status, await res.json().catch(() => null), mode);
      if (out.kind === 'done') onDecided(p, mode, out.message, out.warn, false);
      else if (out.kind === 'stale') onDecided(p, mode, out.message, false, true);
      else setError(out.message);
    } catch {
      setError('Could not save the decision. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          title.current?.focus();
        }}
        className="max-md:!bottom-0 max-md:!left-0 max-md:!top-auto max-md:!max-w-none max-md:!translate-x-0 max-md:!translate-y-0 max-md:rounded-t-2xl max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1} className="outline-none">
            {mode === 'reject' ? 'Reject this payment' : 'Approve this payment'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'reject'
              ? `${planName(p)} for ${who(p)} (${usd(p.amountUsd)}).`
              : approveSummary(p)}
          </DialogDescription>
        </DialogHeader>
        {mode === 'reject' && (
          <div className="space-y-2">
            <label htmlFor="reject-reason" className="text-sm font-medium">
              Reason
            </label>
            <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="reject-hint" maxLength={1000} disabled={busy} />
            <p id="reject-hint" className="text-xs text-muted-foreground">
              {REASON_HINT}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {mode === 'reject' ? (
            <Button type="button" variant="outline" onClick={confirm} disabled={busy || rejectDisabled(reason)} className="min-h-[44px] min-w-[120px] text-danger">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Reject
            </Button>
          ) : (
            <Button type="button" onClick={confirm} disabled={busy} className="min-h-[44px] min-w-[120px]">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Approve
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy} className="min-h-[44px]">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- queue ----

function Facts({ p, onJump }: { p: AdminPaymentDto; onJump: (id: string) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="break-all text-base font-semibold">{who(p)}</p>
        <p className="mt-1 text-sm text-muted-foreground">Submitted {submittedLabel(p.createdAt)}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Plan</dt>
          <dd className="font-medium">{planName(p)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Expected amount</dt>
          <dd className="nums font-medium">{usd(p.amountUsd)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Transaction ID</dt>
          <dd className="nums break-all font-medium">{p.transactionId}</dd>
        </div>
      </dl>
      {p.duplicateOf.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-lg border border-border bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            {duplicateWarningLead} (
            <button type="button" onClick={() => onJump(p.duplicateOf[0])} className="font-medium underline underline-offset-2">
              view
            </button>
            {p.duplicateOf.length > 1 ? `, and ${p.duplicateOf.length - 1} more` : ''}).
          </p>
        </div>
      )}
    </div>
  );
}

function Queue({ onJumpHistory, announce }: { onJumpHistory: () => void; announce: (s: string) => void }) {
  const [rows, setRows] = useState<AdminPaymentDto[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewer, setViewer] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [outcome, setOutcome] = useState<Record<string, { text: string; warn: boolean }>>({});
  const [stale, setStale] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/payments');
      if (!res.ok) throw new Error('bad status');
      const body = (await res.json()) as AdminPaymentsPending;
      setRows(body.requests);
      setError(false);
      setSelected((cur) => cur ?? body.requests[0]?.id ?? null);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const current = rows?.find((r) => r.id === selected) ?? null;
  const done = current ? outcome[current.id] : undefined;
  const isStale = current ? stale.has(current.id) : false;
  const locked = Boolean(done) || isStale;

  function decided(p: AdminPaymentDto, m: Mode, message: string, warn: boolean, wasStale: boolean) {
    setMode(null);
    announce(message);
    if (wasStale) setStale((s) => new Set(s).add(p.id));
    else setOutcome((o) => ({ ...o, [p.id]: { text: message, warn } }));
  }

  function jump(id: string) {
    if (rows?.some((r) => r.id === id)) setSelected(id);
    else onJumpHistory();
  }

  if (error && !rows) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load the queue.{' '}
        <button className="underline" onClick={() => void load()}>
          Retry
        </button>
      </p>
    );
  }
  if (!rows) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{EMPTY_QUEUE}</p>;

  return (
    <div className="lg:grid lg:grid-cols-[20rem_1fr] lg:gap-6">
      <ul className="mb-4 space-y-2 lg:mb-0" aria-label="Pending payments, oldest first">
        {rows.map((r) => {
          const finished = Boolean(outcome[r.id]) || stale.has(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r.id)}
                aria-current={r.id === selected}
                className={`w-full min-h-[44px] rounded-xl border p-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  r.id === selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <span className="block break-all font-medium">{who(r)}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>{planName(r)}</span>
                  <span className="nums">{usd(r.amountUsd)}</span>
                  <span className="nums">{submittedLabel(r.createdAt)}</span>
                  {r.duplicateOf.length > 0 && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3 w-3" aria-hidden />Duplicate ID</span>}
                  {finished && <span>Decided</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {current && (
        <article aria-label={`Payment from ${who(current)}`} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <Facts p={current} onJump={jump} />
          <ReceiptThumb p={current} onOpen={() => setViewer(true)} />
          {locked ? (
            <p role="status" className={`rounded-lg px-3 py-3 text-sm ${done?.warn ? 'bg-warning/10' : 'bg-muted/50'}`}>
              {isStale ? ALREADY_DECIDED_TEXT : done?.text}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setMode('approve')} className="min-h-[44px] min-w-[120px] flex-1 sm:flex-none">
                Approve
              </Button>
              <Button type="button" variant="outline" onClick={() => setMode('reject')} className="min-h-[44px] min-w-[120px] flex-1 text-danger sm:flex-none">
                Reject
              </Button>
            </div>
          )}
          <ReceiptViewer p={current} open={viewer} onClose={() => setViewer(false)} />
          <DecisionSheet p={current} mode={mode} onClose={() => setMode(null)} onDecided={decided} />
        </article>
      )}
    </div>
  );
}

// ---- history ----

const ICONS = { clock: Clock, check: CheckCircle2, x: XCircle } as const;

function History() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminPaymentsHistory | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/payments?view=history&page=${page}`);
        if (!res.ok) throw new Error('bad status');
        const body = (await res.json()) as AdminPaymentsHistory;
        if (alive) {
          setData(body);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page]);

  if (error && !data) return <p className="text-sm text-muted-foreground">Could not load the history.</p>;
  if (!data) return <Skeleton className="h-40 w-full" />;
  if (data.requests.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No decided payments yet.</p>;
  const pages = pageCount(data.total, data.pageSize);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4">
        {data.requests.map((r) => {
          const b = statusBadge(r.status);
          const Icon = ICONS[b.icon];
          return (
            <li key={r.id} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-all font-medium">{who(r)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {r.emailFailed && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      {EMAIL_NOT_SENT}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.className}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {b.label}
                  </span>
                </span>
              </div>
              <p className="nums text-muted-foreground">
                {planName(r)} · {usd(r.amountUsd)} · {r.transactionId}
              </p>
              <p className="text-xs text-muted-foreground">{decidedLine(r)}</p>
              {r.rejectReason && <p className="text-xs">Reason: {r.rejectReason}</p>}
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <nav aria-label="History pages" className="flex items-center justify-between text-sm">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Previous
          </Button>
          <span className="nums text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

export function PaymentsPanel() {
  const [tab, setTab] = useState('queue');
  const [live, setLive] = useState('');
  return (
    <section aria-labelledby="payments-heading">
      <h2 id="payments-heading" className="text-lg font-semibold">
        Payments
      </h2>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
      <Tabs value={tab} onValueChange={setTab} className="mt-3">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <Queue onJumpHistory={() => setTab('history')} announce={setLive} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <History />
        </TabsContent>
      </Tabs>
    </section>
  );
}
