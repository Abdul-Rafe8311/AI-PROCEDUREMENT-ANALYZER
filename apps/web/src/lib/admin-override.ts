// Pure helpers for the admin plan-override form (no I/O, no clock beyond parameters).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const PLAN_LABELS: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max' };

export const planLabel = (plan: string) => PLAN_LABELS[plan] ?? plan;

function parseYmd(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return [y, mo, d];
}

/** "2026-11-30" -> "30 Nov 2026" (locale independent). Returns the input if unparseable. */
export function formatYmd(value: string): string {
  const p = parseYmd(value);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}` : value;
}

/** End of that local day (23:59:59.999) converted to an ISO string; null if the date is invalid. */
export function endOfLocalDayIso(value: string): string | null {
  const p = parseYmd(value);
  if (!p) return null;
  return new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).toISOString();
}

/** True only when the local calendar date is strictly after today's local date. */
export function isStrictlyFutureDate(value: string, now: Date): boolean {
  const p = parseYmd(value);
  if (!p) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return new Date(p[0], p[1] - 1, p[2]).getTime() > today;
}

export function confirmationText(plan: string, ymd: string): string {
  return `Sets ${planLabel(plan)} until ${formatYmd(ymd)}, effective immediately. Falls back to Free at expiry. Recorded in the audit log.`;
}
