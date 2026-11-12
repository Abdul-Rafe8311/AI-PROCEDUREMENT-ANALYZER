// Payment submission and history (AD-6, AD-8). Logic over an injected store so it is unit-tested;
// the Supabase/Storage implementation is in payments-db.ts.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { PAID_PLAN_IDS, type PaidPlanId } from '../entitlements/plans';
import { MAX_PROOF_BYTES, cleanTransactionId, type PaymentDto, type PaymentsPage } from '../payments-types';
import { parsePrices } from './billing-config';
import type { Principal } from './guard';
import type { CaptchaResult } from './turnstile';

/** Multipart field the Turnstile widget token travels in (Cloudflare's own field name). */
export const CAPTCHA_FIELD = 'cf-turnstile-response';

export interface ProofKind {
  ext: 'png' | 'jpg' | 'pdf';
  mime: 'image/png' | 'image/jpeg' | 'application/pdf';
}

/** File type from the first bytes, never from the name or declared type. */
export function sniffProof(b: Uint8Array): ProofKind | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return { ext: 'pdf', mime: 'application/pdf' };
  }
  return null;
}

export interface PaymentRow {
  id: string;
  user_id: string;
  plan: PaidPlanId;
  amount_usd: number;
  transaction_id: string;
  screenshot_path: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface PaymentsStore {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  insert(row: Omit<PaymentRow, 'decided_by' | 'decided_at' | 'reject_reason' | 'created_at'>): Promise<'ok' | 'pending_exists'>;
  list(userId: string, offset: number, limit: number): Promise<{ rows: PaymentRow[]; total: number }>;
  pending(userId: string): Promise<PaymentRow | null>;
  get(id: string): Promise<PaymentRow | null>;
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
}

export const SIGNED_URL_TTL_SECONDS = 60;
const headers = { 'Cache-Control': 'no-store' };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers });
const unavailable = () => json(503, { error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' });

export const toDto = (r: PaymentRow): PaymentDto => ({
  id: r.id,
  plan: r.plan,
  amountUsd: r.amount_usd,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
  decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  rejectReason: r.reject_reason,
  hasScreenshot: Boolean(r.screenshot_path),
});

export interface SubmitDeps {
  store: PaymentsStore;
  /** PLAN_PRICES_USD from config */
  rawPrices: unknown;
  newId?: () => string;
  /** Turnstile verification (AD-9); anything but `ok` stops the request before validation or upload. */
  verifyCaptcha: (token: unknown, req: Request) => Promise<CaptchaResult>;
  /** runs after the row commits; must never throw into the response */
  afterCommit?: (row: PaymentRow) => Promise<void>;
}

function asBlob(v: FormDataEntryValue | null): Blob | null {
  return v && typeof v === 'object' && typeof (v as Blob).arrayBuffer === 'function' ? (v as Blob) : null;
}

/** Multipart framing + text fields on top of the 5 MB file; anything larger is rejected before parsing. */
export const MAX_BODY_BYTES = MAX_PROOF_BYTES + 64 * 1024;

export async function submitPayment(req: Request, principal: Principal, deps: SubmitDeps): Promise<Response> {
  // Refuse oversized bodies before buffering them (a missing/invalid length falls through to the post-parse check).
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json(413, { error: 'Invalid input.', code: 'VALIDATION', fields: { file: 'That file is too large. The limit is 5 MB.' } });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { file: 'Send the form as multipart/form-data.' } });
  }

  // Turnstile (AD-9): after the guard and the multipart parse, before any validation or upload.
  const captcha = await deps.verifyCaptcha(form.get(CAPTCHA_FIELD), req);
  if (!captcha.ok) {
    return captcha.status === 400
      ? json(400, { error: 'Verification failed.', code: 'CAPTCHA_FAILED' })
      : json(503, { error: 'Verification is unavailable.', code: 'CAPTCHA_UNAVAILABLE' });
  }

  const fields: Record<string, string> = {};
  const plan = form.get('plan');
  if (typeof plan !== 'string' || !(PAID_PLAN_IDS as readonly string[]).includes(plan)) fields.plan = 'Choose Plus, Pro or Max.';
  const transactionId = cleanTransactionId(form.get('transactionId'));
  if (!transactionId) fields.transactionId = 'Enter the transaction ID from your bank (up to 100 characters).';
  const file = asBlob(form.get('file'));
  if (!file || file.size === 0) fields.file = 'Attach your receipt as a PNG, JPG or PDF.';
  else if (file.size > MAX_PROOF_BYTES) {
    fields.file = `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB. Try a smaller screenshot or a PDF.`;
  }
  if (Object.keys(fields).length) return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields });

  const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
  const kind = sniffProof(bytes);
  if (!kind) return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { file: 'Only PNG, JPG or PDF files are accepted.' } });

  const price = parsePrices(deps.rawPrices)[plan as PaidPlanId];
  if (price === null || !Number.isInteger(price)) {
    return json(503, { error: 'Payments are not available yet.', code: 'PAYMENTS_UNAVAILABLE' });
  }

  // Cheap pre-check so a user with a request under review cannot make us store (then delete) uploads.
  // The unique index on insert remains the authority for races.
  try {
    if (await deps.store.pending(principal.userId)) {
      return json(409, { error: 'You already have a payment under review.', code: 'PENDING_REQUEST_EXISTS' });
    }
  } catch (err) {
    console.error('[api/payments] pending check failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }

  const id = (deps.newId ?? randomUUID)();
  const path = `${principal.userId}/${id}.${kind.ext}`;
  let uploaded = false;
  try {
    await deps.store.upload(path, bytes, kind.mime);
    uploaded = true;
    const row = {
      id,
      user_id: principal.userId,
      plan: plan as PaidPlanId,
      amount_usd: price,
      transaction_id: transactionId as string,
      screenshot_path: path,
      status: 'pending' as const,
    };
    const res = await deps.store.insert(row);
    if (res === 'pending_exists') {
      await deps.store.remove(path).catch(() => undefined);
      return json(409, { error: 'You already have a payment under review.', code: 'PENDING_REQUEST_EXISTS' });
    }
    const saved: PaymentRow = { ...row, decided_by: null, decided_at: null, reject_reason: null, created_at: new Date().toISOString() };
    // Post-commit side effects never change the outcome (AD-10).
    if (deps.afterCommit) await deps.afterCommit(saved).catch(() => console.error('[api/payments] post-commit step failed'));
    return json(201, { request: toDto(saved) });
  } catch (err) {
    console.error('[api/payments] submit failed:', err instanceof Error ? err.name : 'error');
    if (uploaded) await deps.store.remove(path).catch(() => undefined);
    return unavailable();
  }
}

export function clampPage(url: URL): { page: number; pageSize: number } {
  const n = (k: string, d: number) => {
    const v = Number(url.searchParams.get(k));
    return Number.isInteger(v) && v >= 1 ? v : d;
  };
  return { page: n('page', 1), pageSize: Math.min(n('pageSize', 10), 50) };
}

export async function listOwnPayments(req: Request, principal: Principal, store: PaymentsStore): Promise<Response> {
  const { page, pageSize } = clampPage(new URL(req.url));
  try {
    const [{ rows, total }, pending] = await Promise.all([
      store.list(principal.userId, (page - 1) * pageSize, pageSize),
      store.pending(principal.userId),
    ]);
    const body: PaymentsPage = {
      requests: rows.map(toDto),
      page,
      pageSize,
      total,
      pending: pending ? { id: pending.id, plan: pending.plan, createdAt: new Date(pending.created_at).toISOString() } : null,
    };
    return NextResponse.json(body, { headers });
  } catch (err) {
    console.error('[api/payments] list failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}

/** Owner or admin only; anything else (including an unknown id) is 403 so ids cannot be probed. */
export async function screenshotUrl(
  principal: Principal,
  requestId: string,
  isAdmin: boolean,
  store: PaymentsStore,
): Promise<Response> {
  const forbidden = () => json(403, { error: 'Not allowed.', code: 'FORBIDDEN' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return forbidden();
  try {
    const row = await store.get(requestId);
    if (!row || (row.user_id !== principal.userId && !isAdmin)) return forbidden();
    if (!row.screenshot_path) return json(404, { error: 'Screenshot removed after 12 months.', code: 'SCREENSHOT_REMOVED' });
    const url = await store.signedUrl(row.screenshot_path, SIGNED_URL_TTL_SECONDS);
    return json(200, { url, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    console.error('[api/payments] screenshot failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}
