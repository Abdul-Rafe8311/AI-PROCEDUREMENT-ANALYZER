// GET /api/billing/config (jwt): display config for the Plans page. Prices and the support address
// come from server config, never NEXT_PUBLIC_* (NFR7). Bank details are added in Epic 4, not here.
import { NextResponse } from 'next/server';
import { getConfig, type ServerConfig } from './config';

type Cfg = Pick<ServerConfig, 'planPricesUsd' | 'supportEmail'>;

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

export function buildBillingConfig(deps: { config?: () => Cfg } = {}): Response {
  try {
    const cfg = (deps.config ?? getConfig)();
    return NextResponse.json({ prices: parsePrices(cfg.planPricesUsd), supportEmail: cfg.supportEmail }, { headers });
  } catch {
    console.error('[billing-config] configuration error');
    return NextResponse.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503, headers });
  }
}
