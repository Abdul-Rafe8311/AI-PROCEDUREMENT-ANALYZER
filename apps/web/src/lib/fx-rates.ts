// FX rates for the Technical Approval Form. The TA form normalizes every
// supplier's amounts to SAR (primary) + USD (secondary) at a LIVE market rate,
// fetched at generation time via the same-origin /api/fx route (which reads
// open.er-api.com server-side — see that route for why not Frankfurter).
//
// Resilience: the last SUCCESSFUL rate is cached in localStorage. On a fetch
// failure we return that cached rate (marked `live: false`) so the form still
// generates — labelled "rate as of <timestamp>". We NEVER substitute a hardcoded
// guess: if there is no live rate AND nothing cached, we return null and the
// caller shows amounts in their original currency with a clear note.

export interface FxRates {
  base: 'USD';
  /** units of <currency> per 1 USD, e.g. { USD: 1, SAR: 3.7501, EUR: 0.8758 } */
  rates: Record<string, number>;
  /** when the provider last published the rate (best-effort) */
  asOf: string;
  /** true = fetched live this run; false = served from the persistent cache */
  live: boolean;
  source: string;
}

/** Minimal persistent key/value store (localStorage in the browser; injectable in tests). */
export interface FxStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const CACHE_KEY = 'procurement:fx-rates:v1';

const localStore: FxStore = {
  get: (k) => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    } catch {
      /* SSR / private-mode quota — ignore */
    }
  },
};

function readCache(store: FxStore): FxRates | null {
  const raw = store.get(CACHE_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as FxRates;
    if (p?.rates && typeof p.rates.SAR === 'number' && typeof p.rates.USD === 'number') {
      return { ...p, live: false }; // served from cache → not live
    }
  } catch {
    /* corrupt cache — ignore */
  }
  return null;
}

/**
 * Live FX rates with a persistent-cache fallback. Returns null only when a live
 * fetch fails AND nothing was ever cached.
 */
export async function getFxRates(
  opts: { fetchImpl?: typeof fetch; store?: FxStore; endpoint?: string } = {},
): Promise<FxRates | null> {
  const store = opts.store ?? localStore;
  const endpoint = opts.endpoint ?? '/api/fx';
  const f = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!f) return readCache(store);

  try {
    const res = await f(endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Partial<FxRates>;
    if (!data.rates || typeof data.rates.SAR !== 'number' || typeof data.rates.USD !== 'number') {
      throw new Error('missing SAR/USD');
    }
    const fresh: FxRates = {
      base: 'USD',
      rates: data.rates,
      asOf: data.asOf ?? new Date().toISOString(),
      live: true,
      source: data.source ?? 'open.er-api.com',
    };
    store.set(CACHE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return readCache(store); // last good rate, or null
  }
}

/** Convert `amount` in `currency` to SAR (base=USD rates). null if the rate is unknown. */
export function toSar(amount: number | null | undefined, currency: string, r: FxRates): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const per = r.rates[currency?.toUpperCase()];
  if (!per || !r.rates.SAR) return null;
  return (amount / per) * r.rates.SAR; // amount → USD → SAR
}

/** Convert `amount` in `currency` to USD (base=USD rates). null if the rate is unknown. */
export function toUsd(amount: number | null | undefined, currency: string, r: FxRates): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const per = r.rates[currency?.toUpperCase()];
  if (!per) return null;
  return amount / per;
}

/** How many SAR one unit of `currency` buys, for the on-form rate stamp. */
export function sarPerUnit(currency: string, r: FxRates): number | null {
  return toSar(1, currency, r);
}
