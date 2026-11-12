'use client';

// Shared Cloudflare Turnstile widget (AD-9, UX-DR14). Managed mode, flexible width (fits 320 px),
// height reserved up front so the form never jumps. The parent owns the token: it is single-use,
// so the parent calls `reset()` after every attempt.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { TURNSTILE_HEIGHT_PX, TURNSTILE_SCRIPT_SRC, turnstileSiteKey } from '@/lib/captcha';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileHandle {
  reset: () => void;
  focus: () => void;
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TURNSTILE_SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null; // allow a later retry
        s.remove();
        reject(new Error('turnstile script failed'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export interface TurnstileWidgetProps {
  /** a fresh token, or null when it expired, errored or was reset */
  onToken: (token: string | null) => void;
  /** the script could not load or the widget errored: show the "unavailable" message */
  onUnavailable?: () => void;
  className?: string;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { onToken, onUnavailable, className },
  ref,
) {
  const siteKey = turnstileSiteKey();
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cb = useRef({ onToken, onUnavailable });
  cb.current = { onToken, onUnavailable };

  useImperativeHandle(ref, () => ({
    reset() {
      cb.current.onToken(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
    focus() {
      const el = box.current;
      if (!el) return;
      (el.querySelector<HTMLElement>('iframe') ?? el).focus();
    },
  }));

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          size: 'flexible',
          appearance: 'always',
          callback: (t: string) => cb.current.onToken(t),
          'expired-callback': () => cb.current.onToken(null),
          'timeout-callback': () => cb.current.onToken(null),
          'error-callback': () => {
            cb.current.onToken(null);
            cb.current.onUnavailable?.();
            return true;
          },
        });
      })
      .catch(() => {
        if (!cancelled) cb.current.onUnavailable?.();
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  // No site key in this deployment: render nothing. The server still rejects requests without a token.
  if (!siteKey) return null;
  return (
    <div
      ref={box}
      tabIndex={-1}
      aria-label="Verification"
      className={className}
      style={{ minHeight: TURNSTILE_HEIGHT_PX }}
      data-testid="turnstile"
    />
  );
});
