// Pure view-model for the header usage meter (UX-DR1). No React, so it is unit-tested.
export interface MeterInput {
  plan: string;
  used: number;
  quota: number;
}

export interface MeterModel {
  text: string;
  now: number;
  max: number;
  pct: number;
  tone: 'ok' | 'warning' | 'danger';
}

export function meterModel(e: MeterInput): MeterModel {
  const max = Math.max(e.quota, 0);
  const now = Math.min(Math.max(e.used, 0), max);
  const pct = max > 0 ? Math.round((now / max) * 100) : 0;
  const tone = max > 0 && e.used >= max ? 'danger' : pct >= 80 ? 'warning' : 'ok';
  const per = e.plan === 'free' ? 'this month' : 'this period';
  return { text: `${e.used} / ${e.quota} PDFs used ${per}`, now, max, pct, tone };
}
