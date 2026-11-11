// Plans-page info notices (UX-DR15): inline only, never a popup. Pure; the one-time "ended" state
// is remembered by the component (per-viewer convenience), keyed by `endedAt`.
import { formatQuotaDate } from './entitlements/quota-window';
import { planLabel } from './quota-callout';

export interface NoticeInput {
  plan: string;
  expiresAt: string | null;
  lastExpired: { plan: string; endedAt: string } | null;
}

export interface PlanNotice {
  kind: 'ending' | 'ended';
  text: string;
  /** identifies the event, so "ended" is shown once per ended period */
  key: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function planNotice(e: NoticeInput, now: Date, alreadyToldEndedAt: string | null): PlanNotice | null {
  if (e.plan !== 'free' && e.expiresAt) {
    const left = new Date(e.expiresAt).getTime() - now.getTime();
    if (left > 0 && left <= 3 * DAY) {
      return {
        kind: 'ending',
        key: e.expiresAt,
        text: `Your ${planLabel(e.plan)} plan ends on ${formatQuotaDate(e.expiresAt)}. Renew to add 30 more days.`,
      };
    }
    return null;
  }
  if (e.plan === 'free' && e.lastExpired && e.lastExpired.endedAt !== alreadyToldEndedAt) {
    return {
      kind: 'ended',
      key: e.lastExpired.endedAt,
      text: `Your ${planLabel(e.lastExpired.plan)} plan ended on ${formatQuotaDate(e.lastExpired.endedAt)}. You're on Free. Your data is still here.`,
    };
  }
  return null;
}
