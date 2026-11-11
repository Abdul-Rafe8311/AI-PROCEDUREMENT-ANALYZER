// GET /api/billing/config (jwt): display config for the Plans page. Prices and the support address
// come from server config, never NEXT_PUBLIC_* (NFR7). Bank details (BANK_DETAILS) are served here too, to signed-in users only.
import { NextResponse } from 'next/server';
import { getConfig, type ServerConfig } from './config';

type Cfg = Pick<ServerConfig, 'planPricesUsd' | 'supportEmail'> & Partial<Pick<ServerConfig, 'bankDetails'>>;

const headers = { 'Cache-Control': 'no-store' };
const PAID = ['plus', 'pro', 'max'] as const;

export function parsePrices(raw: unknown): Record<(typeof PAID)[number], number | null> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { plus: null, pro: null, max: null } as Record<(typeof PAID)[number], number | null>;
  for (const p of PAID) {
    const v = o[p];
    out[p] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }
  return out;
}

export interface BankRow {
  key: string;
  label: string;
  value: string;
}

const ACRONYMS = new Set(['iban', 'swift', 'bic', 'sort', 'aba']);

function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/);
  return words
    .map((w, i) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

/** Parses BANK_DETAILS: an object of key->value or an array of {label,value}. Anything else is []. */
export function parseBankDetails(raw: unknown): BankRow[] {
  const clean = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  };
  const rows: BankRow[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      const label = clean(o?.label);
      const value = clean(o?.value);
      if (label && value) rows.push({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label, value });
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
      const value = clean(v);
      if (value) rows.push({ key, label: humanize(key), value });
    }
  }
  return rows;
}

export function buildBillingConfig(deps: { config?: () => Cfg } = {}): Response {
  try {
    const cfg = (deps.config ?? getConfig)();
    return NextResponse.json(
      { prices: parsePrices(cfg.planPricesUsd), supportEmail: cfg.supportEmail, bank: parseBankDetails(cfg.bankDetails) },
      { headers },
    );
  } catch {
    console.error('[billing-config] configuration error');
    return NextResponse.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503, headers });
  }
}
