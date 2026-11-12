'use client';

// Turnstile for the three native-auth forms (AD-9): the token goes to Supabase as `options.captchaToken`;
// there is no custom verifier here. One hook keeps signup, login and password reset identical.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { TurnstileWidget, type TurnstileHandle } from '@/components/turnstile-widget';
import { CAPTCHA_UNAVAILABLE_MESSAGE, isCaptchaMessage, submitBlocked, turnstileSiteKey } from '@/lib/captcha';

export interface CaptchaField {
  /** a token is required before submit (false when this deployment has no site key) */
  required: boolean;
  token: string | null;
  /** true while submit must stay disabled for lack of a token */
  waiting: boolean;
  /** call after every attempt: tokens are single-use. Pass the error shown, if any, to focus the widget. */
  settle: (shownError?: string | null) => void;
  /** the widget plus its inline message; place it under the last field, above the submit button */
  node: ReactNode;
}

export function useCaptchaField(): CaptchaField {
  const ref = useRef<TurnstileHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const required = turnstileSiteKey() !== null;

  const settle = useCallback((shownError?: string | null) => {
    ref.current?.reset();
    if (isCaptchaMessage(shownError ?? null)) ref.current?.focus();
  }, []);

  const node = required ? (
    <div className="space-y-2">
      <TurnstileWidget ref={ref} onToken={setToken} onUnavailable={() => setUnavailable(true)} />
      {unavailable && (
        <p role="alert" className="text-sm text-danger">
          {CAPTCHA_UNAVAILABLE_MESSAGE}
        </p>
      )}
    </div>
  ) : null;

  return { required, token, waiting: submitBlocked({ required, token, busy: false }), settle, node };
}
