// Plan prices for server-rendered public pages (JSON-LD, llms.txt). Same source as /api/billing/prices.
// Never throws: a missing or invalid config just means no prices are published.
import { getConfig } from './config';
import { parsePrices } from './billing-config';
import type { PlanPrices } from '../plan-matrix';

export function getPublicPrices(): PlanPrices | null {
  try {
    return parsePrices(getConfig().planPricesUsd);
  } catch {
    return null;
  }
}
