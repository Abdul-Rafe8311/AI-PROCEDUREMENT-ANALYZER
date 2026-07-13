import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function initials(first?: string, last?: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || 'U';
}

/**
 * True when a dynamic `import()` failed because its code-split chunk 404'd — which
 * happens when the tab was opened on an OLDER build and a new deploy replaced the
 * chunk files. The fix is a page refresh, not a retry, so callers show that instead.
 */
export function isChunkLoadError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const msg = (err as { message?: string })?.message ?? String(err ?? '');
  return name === 'ChunkLoadError' || /Loading chunk [^ ]+ failed|dynamically imported module/i.test(msg);
}

/** Message for a stale-deploy chunk failure — tells the user to refresh. */
export const STALE_BUILD_MESSAGE =
  'A new version was just deployed. Please refresh the page (⌘/Ctrl+Shift+R), then try again.';
