'use client';

import { useEffect, useState } from 'react';
import { getFxRates, type FxRates } from './fx-rates';

// One shared in-memory copy of the live rate so every consumer (comparison view,
// dashboard, charts) reads the SAME rate the TA form uses — no per-component fetch
// storms, and no divergent rates. Backed by fx-rates' localStorage cache.
let shared: FxRates | null = null;
let inflight: Promise<FxRates | null> | null = null;

/**
 * Live FX rates for client display. Returns null until the first fetch resolves
 * (and stays null only when there is no live rate AND nothing cached — callers
 * then show original-currency amounts, never a hardcoded guess).
 */
export function useFxRates(): FxRates | null {
  const [fx, setFx] = useState<FxRates | null>(shared);

  useEffect(() => {
    if (shared) {
      setFx(shared);
      return;
    }
    let alive = true;
    inflight ??= getFxRates();
    inflight.then((r) => {
      if (r) shared = r;
      if (alive) setFx(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  return fx;
}
