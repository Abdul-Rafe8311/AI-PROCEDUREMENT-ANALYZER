// Pure copy and rules for the Turnstile widget (AD-9, UX-DR14). No I/O, no DOM.
export const CAPTCHA_FAILED_MESSAGE = 'Verification failed. Please try again.';
export const CAPTCHA_UNAVAILABLE_MESSAGE = 'Verification is unavailable right now. Please try again in a moment.';
export const CAPTCHA_WAIT_HINT = 'Complete the verification to continue.';

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Space reserved for the widget so the form never jumps when it loads. */
export const TURNSTILE_HEIGHT_PX = 65;

/** Public site key, or null when this deployment has none (the server still rejects without a token). */
export function turnstileSiteKey(raw: string | undefined = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY): string | null {
  const k = raw?.trim();
  return k ? k : null;
}

/** Submit is blocked while a token is required and missing, or while a request is in flight. */
export function submitBlocked(o: { required: boolean; token: string | null; busy: boolean }): boolean {
  return o.busy || (o.required && !o.token);
}

/** API response code -> message, or null when the code is not a captcha code. */
export function captchaMessageForCode(code: unknown): string | null {
  if (code === 'CAPTCHA_FAILED') return CAPTCHA_FAILED_MESSAGE;
  if (code === 'CAPTCHA_UNAVAILABLE') return CAPTCHA_UNAVAILABLE_MESSAGE;
  return null;
}

/**
 * Supabase Auth error -> captcha message, or null when the error is something else.
 * GoTrue reports a rejected token as `captcha_failed`; a 5xx while a token was sent is its provider call failing.
 */
export function captchaMessageForAuthError(err: unknown, tokenSent: boolean): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; message?: unknown; status?: unknown };
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (e.code === 'captcha_failed' || message.includes('captcha')) return CAPTCHA_FAILED_MESSAGE;
  if (tokenSent && typeof e.status === 'number' && e.status >= 500) return CAPTCHA_UNAVAILABLE_MESSAGE;
  return null;
}
