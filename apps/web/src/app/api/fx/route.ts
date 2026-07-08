import { NextResponse } from 'next/server';

// Live FX rates for the Technical Approval Form (SAR primary + USD secondary).
//
// SOURCE: open.er-api.com (exchangerate-api.com free tier — no API key).
// We do NOT use Frankfurter: its ECB feed does not carry SAR (the riyal is
// USD-pegged and omitted). Verified at build time —
//   • https://api.frankfurter.app/currencies → no "SAR" entry (301s + absent).
//   • https://open.er-api.com/v6/latest/USD → includes SAR, USD, EUR, …
// Fetched with base=USD so every pair (EUR→SAR, EUR→USD, SAR→USD) derives from it.
//
// Fetched server-side (no browser CORS dependency). The client caches the last
// successful result in localStorage and falls back to it if this route fails.

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

export const dynamic = 'force-dynamic'; // never statically cached — rates move

export async function GET() {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    if (data.result !== 'success' || !data.rates?.SAR || !data.rates?.USD) {
      throw new Error('upstream missing SAR/USD');
    }
    return NextResponse.json({
      base: 'USD',
      rates: data.rates,
      asOf: data.time_last_update_utc ?? new Date().toUTCString(),
      source: 'open.er-api.com',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `FX fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
