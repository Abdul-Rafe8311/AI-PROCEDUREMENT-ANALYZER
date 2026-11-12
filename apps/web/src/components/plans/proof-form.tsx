'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FileUp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget, type TurnstileHandle } from '@/components/turnstile-widget';
import { CAPTCHA_UNAVAILABLE_MESSAGE, submitBlocked, turnstileSiteKey } from '@/lib/captcha';
import { apiFetch } from '@/lib/api-fetch';
import type { PaidPlanId } from '@/lib/entitlements/plans';
import {
  NETWORK_FAILURE,
  PROOF_ACCEPT,
  checkProofFile,
  formatSize,
  interpretSubmit,
  type FieldName,
} from '@/lib/payment-form';

export function ProofForm({ plan, onSubmitted }: { plan: PaidPlanId; onSubmitted: (submittedAt: string) => void }) {
  const uid = useId();
  const ids = { tx: `${uid}-tx`, file: `${uid}-file`, txErr: `${uid}-tx-err`, fileErr: `${uid}-file-err` };
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const txRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const widget = useRef<TurnstileHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const captchaRequired = turnstileSiteKey() !== null;

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(f: File | null | undefined) {
    if (!f) return;
    const problem = checkProofFile(f);
    if (problem) {
      setFile(null);
      setErrors((e) => ({ ...e, file: problem }));
      return;
    }
    setFile(f);
    setErrors((e) => ({ ...e, file: undefined }));
  }

  function focusField(name: FieldName) {
    (name === 'transactionId' ? txRef.current : dropRef.current)?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return; // no double submit
    const local: Partial<Record<FieldName, string>> = {};
    if (!transactionId.trim()) local.transactionId = 'Enter the transaction ID from your bank.';
    if (!file) local.file = 'Attach your receipt as a PNG, JPG or PDF.';
    if (local.transactionId || local.file) {
      setErrors(local);
      focusField(local.transactionId ? 'transactionId' : 'file');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    setCaptchaError(null);
    try {
      const body = new FormData();
      body.set('plan', plan);
      body.set('transactionId', transactionId.trim());
      body.set('file', file as File);
      if (token) body.set('cf-turnstile-response', token);
      const res = await apiFetch('/api/payments', { method: 'POST', body });
      const json = await res.json().catch(() => null);
      const out = interpretSubmit(res.status, json);
      if (out.kind === 'ok') {
        onSubmitted(new Date().toISOString());
      } else if (out.kind === 'pending') {
        onSubmitted(new Date().toISOString());
      } else if (out.kind === 'fields') {
        setErrors(out.fields);
        focusField(out.first);
      } else if (out.kind === 'captcha') {
        setCaptchaError(out.message);
        widget.current?.focus(); // the alert below announces the message
      } else if (out.kind === 'error') {
        setFormError(out.message);
      }
    } catch {
      setFormError(NETWORK_FAILURE); // details (typed ID and file) are kept
    } finally {
      inFlight.current = false;
      setBusy(false);
      // A token is single-use: fresh challenge after every attempt. Typed ID and file stay as they are.
      widget.current?.reset();
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-busy={busy}>
      <div className="space-y-2">
        <Label htmlFor={ids.tx}>Transaction ID</Label>
        <Input
          id={ids.tx}
          ref={txRef}
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          maxLength={100}
          autoComplete="off"
          className="nums min-h-[44px]"
          aria-invalid={Boolean(errors.transactionId)}
          aria-describedby={errors.transactionId ? ids.txErr : undefined}
          disabled={busy}
        />
        {errors.transactionId && (
          <p id={ids.txErr} role="alert" className="text-sm text-danger">
            {errors.transactionId}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.file}>Receipt</Label>
        <input
          id={ids.file}
          ref={fileRef}
          type="file"
          accept={PROOF_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = '';
          }}
          disabled={busy}
        />
        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Receipt preview" className="h-16 w-16 rounded-md object-cover" />
            ) : (
              <FileUp className="h-8 w-8 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="nums text-xs text-muted-foreground">{formatSize(file.size)}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFile(null)}
              disabled={busy}
              className="min-h-[44px]"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" aria-hidden /> Remove
            </Button>
          </div>
        ) : (
          <button
            type="button"
            ref={dropRef}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files?.[0]);
            }}
            disabled={busy}
            aria-describedby={errors.file ? ids.fileErr : undefined}
            className={`flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:bg-muted/50'
            }`}
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="font-medium">Drop your receipt here, or tap to choose</span>
            <span className="text-xs text-muted-foreground">PNG, JPG or PDF, up to 5 MB. On a phone you can use the camera or gallery.</span>
          </button>
        )}
        {errors.file && (
          <p id={ids.fileErr} role="alert" className="text-sm text-danger">
            {errors.file}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <TurnstileWidget
          action="payment"
          ref={widget}
          onToken={setToken}
          onUnavailable={() => setCaptchaError(CAPTCHA_UNAVAILABLE_MESSAGE)}
        />
        {captchaError && (
          <p role="alert" className="text-sm text-danger">
            {captchaError}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={submitBlocked({ required: captchaRequired, token, busy })} className="min-h-[44px] w-full sm:w-auto">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Uploading…
          </>
        ) : (
          'Submit payment proof'
        )}
      </Button>
    </form>
  );
}
