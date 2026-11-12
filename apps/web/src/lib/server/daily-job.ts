// Daily job (Epic 6): expiry reminders (6.1) and screenshot retention (6.2). Pure orchestration over
// injected stores so every branch is testable without Supabase, Resend or a clock. It never writes
// plan_periods and logs counts only (no emails, ids or tokens).
import { sendEmail, ALREADY_CLAIMED, type SendResult } from './email';
import type { EmailPayload, EmailTemplate } from './email-templates';
import { dateLabel } from '../payment-form';
import { SITE_URL } from '../site';

export const REMINDER_WINDOW_DAYS = 3;
export const RETENTION_MONTHS = 12;
export const RETENTION_BATCH = 200;

export interface ExpiringPeriod {
  id: string;
  userId: string;
  plan: string;
  endsAt: string;
}

export interface ExpiryStore {
  /** non-voided periods with now < ends_at <= windowEnd */
  expiring(now: Date, windowEnd: Date): Promise<ExpiringPeriod[]>;
  /** user ids (of the given users) that have a non-voided period starting at or after `since` */
  renewedUsers(userIds: string[], since: Date): Promise<Array<{ userId: string; startsAt: string }>>;
  /** null when the user has no email */
  emailFor(userId: string): Promise<string | null>;
}

export interface RetentionStore {
  /** requests with a screenshot created before `cutoff`, oldest first */
  stale(cutoff: Date, limit: number): Promise<Array<{ id: string; path: string }>>;
  removeObject(path: string): Promise<void>;
  clearPath(id: string): Promise<void>;
}

export type SendFn = (template: EmailTemplate, to: string, data: EmailPayload, opts: { subjectId: string }) => Promise<SendResult>;

export interface ReminderSummary {
  considered: number;
  sent: number;
  failed: number;
  /** already reminded, renewed, or user has no email */
  skipped: number;
}

export interface RetentionSummary {
  deleted: number;
  failed: number;
}

export function windowEnd(now: Date): Date {
  return new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function retentionCutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

const defaultSend: SendFn = (t, to, data, opts) => sendEmail(t, to, data, opts);

export async function sendExpiryReminders(
  now: Date,
  store: ExpiryStore,
  send: SendFn = defaultSend,
  siteUrl: string = SITE_URL,
): Promise<ReminderSummary> {
  const summary: ReminderSummary = { considered: 0, sent: 0, failed: 0, skipped: 0 };
  const periods = await store.expiring(now, windowEnd(now));
  summary.considered = periods.length;
  if (!periods.length) return summary;

  const earliestEnd = new Date(Math.min(...periods.map((p) => Date.parse(p.endsAt))));
  const later = await store.renewedUsers([...new Set(periods.map((p) => p.userId))], earliestEnd);

  for (const p of periods) {
    const renewed = later.some((l) => l.userId === p.userId && Date.parse(l.startsAt) >= Date.parse(p.endsAt));
    if (renewed) {
      summary.skipped++;
      continue;
    }
    try {
      const to = await store.emailFor(p.userId);
      if (!to) {
        summary.skipped++;
        continue;
      }
      const r = await send(
        'expiry_reminder',
        to,
        { plan: p.plan, expiresOn: dateLabel(p.endsAt), plansUrl: `${siteUrl}/plans` },
        { subjectId: p.id },
      );
      if (r.ok) summary.sent++;
      else if (r.error === ALREADY_CLAIMED) summary.skipped++;
      else summary.failed++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

/** Delete the object first; only then null the path, so a failed delete is retried tomorrow. */
export async function purgeOldScreenshots(now: Date, store: RetentionStore): Promise<RetentionSummary> {
  const summary: RetentionSummary = { deleted: 0, failed: 0 };
  const rows = await store.stale(retentionCutoff(now), RETENTION_BATCH);
  for (const r of rows) {
    try {
      await store.removeObject(r.path);
      await store.clearPath(r.id);
      summary.deleted++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

export interface DailyResult {
  reminders: ReminderSummary | { error: true };
  retention: RetentionSummary | { error: true };
}

/** The two tasks are independent: one failing never stops the other. */
export async function runDailyJob(
  now: Date,
  deps: { expiry: ExpiryStore; retention: RetentionStore; send?: SendFn; siteUrl?: string },
): Promise<DailyResult> {
  const reminders = await sendExpiryReminders(now, deps.expiry, deps.send, deps.siteUrl).catch(() => {
    console.error('[cron] reminders task failed');
    return { error: true as const };
  });
  const retention = await purgeOldScreenshots(now, deps.retention).catch(() => {
    console.error('[cron] retention task failed');
    return { error: true as const };
  });
  return { reminders, retention };
}
