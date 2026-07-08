'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/workspace-types';

export type CurrencyMode = 'original' | 'usd';

const STORAGE_KEY = 'procurement:currency-mode';

/** Session-persisted currency display mode. Default: original. */
export function useCurrencyMode(): [CurrencyMode, (m: CurrencyMode) => void] {
  const [mode, setMode] = useState<CurrencyMode>('original');

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved === 'original' || saved === 'usd') setMode(saved);
  }, []);

  const update = (m: CurrencyMode) => {
    setMode(m);
    try {
      sessionStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  return [mode, update];
}

export function CurrencyToggle({
  mode,
  onChange,
}: {
  mode: CurrencyMode;
  onChange: (m: CurrencyMode) => void;
}) {
  const options: { value: CurrencyMode; label: string }[] = [
    { value: 'original', label: 'Original' },
    { value: 'usd', label: 'USD' },
  ];
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 transition',
            mode === o.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={mode === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders a monetary value per the selected mode.
 * - original: primary in the document currency, small "≈ USD" secondary (non-USD only)
 * - usd: primary in USD
 * Highlight/comparison decisions are made by callers using the USD value.
 */
export function MoneyDual({
  amount,
  currency,
  usd,
  mode,
  align = 'end',
  precise = false,
}: {
  amount: number | null;
  currency: string;
  usd: number | null;
  mode: CurrencyMode;
  align?: 'start' | 'end';
  /** unit prices show 2 decimals (never rounded to a whole number); totals show 0 */
  precise?: boolean;
}) {
  if (amount == null && usd == null) return <>—</>;
  const digits = precise ? 2 : 0;

  if (mode === 'usd') {
    return <span>{formatCurrency(usd ?? amount, usd != null ? 'USD' : currency, digits)}</span>;
  }

  const showApprox = currency !== 'USD' && usd != null && amount != null;
  return (
    <span className={cn('inline-flex flex-col leading-tight', align === 'end' ? 'items-end' : 'items-start')}>
      <span>{formatCurrency(amount ?? usd, amount != null ? currency : 'USD', digits)}</span>
      {showApprox && (
        <span className="text-xs font-normal text-muted-foreground">
          ≈ {formatCurrency(usd, 'USD', digits)}
        </span>
      )}
    </span>
  );
}
