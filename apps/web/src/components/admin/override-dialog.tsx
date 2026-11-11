'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api-fetch';
import {
  confirmationText,
  endOfLocalDayIso,
  isStrictlyFutureDate,
  planLabel,
} from '@/lib/admin-override';

export interface OverrideResult {
  plan: string;
  endsAt: string;
}

const PLANS = ['plus', 'pro', 'max'] as const;

// Inline override form for one user; submit opens the confirmation dialog.
export function OverrideForm({
  userId,
  email,
  onDone,
  onCancel,
}: {
  userId: string;
  email: string | null;
  onDone: (r: OverrideResult) => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState<string>('pro');
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerFields({});
    if (!date || !isStrictlyFutureDate(date, new Date())) {
      setDateError('Choose a date after today.');
      return;
    }
    setDateError(null);
    setConfirming(true);
  }

  async function onConfirm() {
    const endsAt = endOfLocalDayIso(date);
    if (!endsAt) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan, endsAt }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfirming(false);
        onDone({ plan: body.plan ?? plan, endsAt: body.endsAt ?? endsAt });
        return;
      }
      if (body?.code === 'VALIDATION' && body.fields) {
        const f = body.fields as Record<string, string>;
        setServerFields(f);
        setConfirming(false);
        if (!f.plan && !f.endsAt) toast.error(Object.values(f)[0] ?? 'Invalid input.');
        return;
      }
      toast.error('Could not update the plan. Please try again.');
    } catch {
      toast.error('Could not update the plan. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const fieldMsg = (k: string) => serverFields[k];

  return (
    <>
      <form onSubmit={onSubmit} className="mt-3 grid gap-3 rounded-md border border-border/70 p-3" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`plan-${userId}`}>Plan</Label>
          <select
            id={`plan-${userId}`}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {planLabel(p)}
              </option>
            ))}
          </select>
          {fieldMsg('plan') && <p className="text-sm text-destructive">{fieldMsg('plan')}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`date-${userId}`}>Expires on</Label>
          <Input
            id={`date-${userId}`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={Boolean(dateError || fieldMsg('endsAt'))}
            className="h-11"
          />
          {(dateError || fieldMsg('endsAt')) && (
            <p className="text-sm text-destructive">{dateError ?? fieldMsg('endsAt')}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-11">
            Review change
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            titleRef.current?.focus();
          }}
          className="inset-x-0 bottom-0 left-0 top-auto max-w-none translate-x-0 translate-y-0 rounded-t-xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
        >
          <DialogHeader>
            <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
              Confirm plan change{email ? ` for ${email}` : ''}
            </DialogTitle>
            <DialogDescription>{confirmationText(plan, date)}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="h-11" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button className="h-11" disabled={busy} onClick={onConfirm}>
              {busy ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
