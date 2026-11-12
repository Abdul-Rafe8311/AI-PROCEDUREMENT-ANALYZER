// guard: public
// GET /api/billing/prices: the plan prices only, for the logged-out Pricing section on the home page.
// Same source and parser as /api/billing/config (which stays JWT-only because it also serves bank details).
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/server/config';
import { parsePrices } from '@/lib/server/billing-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ prices: parsePrices(getConfig().planPricesUsd) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[billing-prices] configuration error');
    return NextResponse.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
