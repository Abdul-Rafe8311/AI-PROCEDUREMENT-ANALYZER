// Single data source for the Plans page cards and comparison table (UX-DR4, UX-DR5). Pure.
import {
  PLAN_IDS,
  hasChatAccess,
  hasPrioritySupport,
  hasTenderSheetAccess,
  planQuota,
  supportTargetHours,
  type PlanId,
} from './entitlements/plans';

export type PlanPrices = Partial<Record<PlanId, number | null>>;
export type Cell = boolean | string;

export interface PlanColumn {
  id: PlanId;
  name: string;
  price: string;
  quota: number;
  chat: boolean;
  tender: boolean;
  support: string;
}

export interface ComparisonRow {
  label: string;
  values: Record<PlanId, Cell>;
}

export const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max' };

export function formatPrice(id: PlanId, prices: PlanPrices | null): string {
  if (id === 'free') return '$0';
  const v = prices?.[id];
  return typeof v === 'number' && Number.isFinite(v) ? `$${v}` : '—';
}

export function planColumns(prices: PlanPrices | null): PlanColumn[] {
  return PLAN_IDS.map((id) => ({
    id,
    name: PLAN_NAMES[id],
    price: formatPrice(id, prices),
    quota: planQuota(id),
    chat: hasChatAccess(id),
    tender: hasTenderSheetAccess(id),
    support: `${supportTargetHours(id)}h reply${hasPrioritySupport(id) ? ' (priority)' : ''}`,
  }));
}

export function comparisonRows(prices: PlanPrices | null): ComparisonRow[] {
  const cols = planColumns(prices);
  const row = (label: string, pick: (c: PlanColumn) => Cell): ComparisonRow => ({
    label,
    values: Object.fromEntries(cols.map((c) => [c.id, pick(c)])) as Record<PlanId, Cell>,
  });
  return [
    row('PDFs per month', (c) => String(c.quota)),
    row('Chatbox', (c) => c.chat),
    row('Tender sheet', (c) => c.tender),
    row('Priority Support', (c) => c.support),
    row('Price', (c) => `${c.price} / month`),
  ];
}
