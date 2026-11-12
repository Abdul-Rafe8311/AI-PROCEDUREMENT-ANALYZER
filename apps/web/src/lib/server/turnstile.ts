// The only code that calls Cloudflare Turnstile `siteverify` (AD-9). Fails closed: anything that is not
// an explicit success is a rejection, and anything that is Cloudflare's or our fault is 503, not 400.
import { getConfig } from './config';

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const VERIFY_TIMEOUT_MS = 5000;
/** Action the payment form's widget is rendered with; the server requires it back. */
export const PAYMENT_CAPTCHA_ACTION = 'payment';

export type CaptchaResult =
  | { ok: true }
  | { ok: false; status: 400; code: 'CAPTCHA_FAILED' }
  | { ok: false; status: 503; code: 'CAPTCHA_UNAVAILABLE' };

export interface TurnstileExpect {
  /** Must equal the `action` the widget was rendered with, so a token minted for another form is useless here. */
  action?: string;
  /** Hostname of this deployment; checked against siteverify's `hostname`. Skipped for localhost. */
  hostname?: string;
}

export interface TurnstileDeps {
  secret?: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const FAILED: CaptchaResult = { ok: false, status: 400, code: 'CAPTCHA_FAILED' };
const UNAVAILABLE: CaptchaResult = { ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' };

/** Token problems the user can fix by solving the widget again. Everything else is unavailable. */
const USER_CODES = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']);

const MAX_TOKEN_LENGTH = 2048; // Cloudflare's documented maximum

function logCode(code: string) {
  // Codes only: never the token, the secret or the response body.
  console.error('[turnstile] verification rejected:', code.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'unknown');
}

/** A single valid IP from the platform-set x-real-ip header, else undefined (omit remoteip). */
export function trustedClientIp(req: Request): string | undefined {
  const v = req.headers.get('x-real-ip')?.trim();
  if (!v || /[,\s]/.test(v)) return undefined;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (v4) return v4.slice(1).every((p) => Number(p) <= 255) ? v : undefined;
  return /^[0-9a-f:]+$/i.test(v) && v.includes(':') && v.length <= 45 ? v : undefined;
}

/** Host the request was addressed to (no port), for the siteverify hostname check. */
export function requestHostname(req: Request): string | undefined {
  const h = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim().toLowerCase();
  return h.replace(/:\d+$/, '') || undefined;
}

export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | undefined,
  deps: TurnstileDeps = {},
  expect: TurnstileExpect = {},
): Promise<CaptchaResult> {
  let secret: string | null;
  try {
    secret = (deps.secret ?? (() => getConfig().turnstileSecretKey))();
  } catch {
    logCode('config-error');
    return UNAVAILABLE;
  }
  if (!secret) {
    logCode('missing-input-secret');
    return UNAVAILABLE;
  }
  if (typeof token !== 'string' || !token.trim() || token.length > MAX_TOKEN_LENGTH) {
    logCode('missing-input-response');
    return FAILED;
  }

  const body = new URLSearchParams({ secret, response: token.trim() });
  if (remoteIp) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? VERIFY_TIMEOUT_MS);
  try {
    const res = await (deps.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      logCode(`http-${res.status}`);
      return UNAVAILABLE;
    }
    const json = (await res.json()) as { success?: unknown; action?: unknown; hostname?: unknown; 'error-codes'?: unknown };
    if (json.success === true) {
      if (expect.action !== undefined && json.action !== expect.action) {
        logCode('action-mismatch');
        return FAILED;
      }
      if (expect.hostname && !/^(localhost|127\.0\.0\.1)$/.test(expect.hostname) && json.hostname !== expect.hostname) {
        logCode('hostname-mismatch');
        return FAILED;
      }
      return { ok: true };
    }
    const codes = Array.isArray(json['error-codes']) ? (json['error-codes'] as unknown[]).filter((c): c is string => typeof c === 'string') : [];
    logCode(codes.join(',') || 'no-error-code');
    // A user-fixable code only counts when no service-side code is present alongside it.
    return codes.length > 0 && codes.every((c) => USER_CODES.has(c)) ? FAILED : UNAVAILABLE;
  } catch (err) {
    logCode(err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network-error');
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}
