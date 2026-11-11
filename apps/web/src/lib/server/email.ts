// The only place that calls Resend (AD-10). Typed, best-effort, post-commit: it never throws, never
// changes a payment or plan outcome and records every attempt in email_log.
import { Resend } from 'resend';
import { getConfig, type ServerConfig } from './config';
import { DbUnavailableError, serviceClient } from './db';
import { EMAIL_TEMPLATES, renderEmail, type EmailData, type EmailPayload, type EmailTemplate } from './email-templates';

export { EMAIL_TEMPLATES, type EmailData, type EmailTemplate };

export interface SendResult {
  ok: boolean;
  status: 'sent' | 'failed';
  error?: string;
}

export interface EmailLogStore {
  /** returns the row id, or null when the claim already exists (reminders) */
  start(row: { template: EmailTemplate; to: string; subjectId: string | null }): Promise<string | null>;
  finish(id: string, status: 'sent' | 'failed', error: string | null): Promise<void>;
}

export interface EmailDeps {
  config?: () => Pick<ServerConfig, 'resendApiKey' | 'emailFrom'>;
  /** Resend-shaped sender: resolves { error } instead of throwing on API errors */
  send?: (msg: { from: string; to: string; subject: string; html: string; text: string }) => Promise<{ error: { message?: string } | null }>;
  log?: EmailLogStore;
}

export interface SendOptions {
  /** payment request id or plan period id, for log lookups and reminder de-duplication */
  subjectId?: string | null;
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 300);

export function supabaseEmailLog(): EmailLogStore {
  return {
    async start(row) {
      const client = serviceClient();
      const { data, error } = await client
        .from('email_log')
        .insert({ template: row.template, to_email: row.to, subject_id: row.subjectId, status: 'pending' })
        .select('id')
        .single();
      if (error) {
        if ((error as { code?: string }).code === '23505') return null;
        throw new DbUnavailableError('email_log insert failed');
      }
      return (data as { id: string }).id;
    },
    async finish(id, status, error) {
      const { error: e } = await serviceClient().from('email_log').update({ status, error }).eq('id', id);
      if (e) throw new DbUnavailableError('email_log update failed');
    },
  };
}

function resendSender(apiKey: string): NonNullable<EmailDeps['send']> {
  const client = new Resend(apiKey);
  return async (msg) => {
    const { error } = await client.emails.send(msg);
    return { error: error ? { message: error.message } : null };
  };
}

export async function sendEmail(
  template: EmailTemplate,
  to: string,
  data: EmailPayload,
  opts: SendOptions = {},
  deps: EmailDeps = {},
): Promise<SendResult> {
  if (!(EMAIL_TEMPLATES as readonly string[]).includes(template)) {
    console.error('[email] refused unknown template');
    return { ok: false, status: 'failed', error: 'unknown template' };
  }
  const log = deps.log ?? supabaseEmailLog();
  let logId: string | null = null;
  let logged = false;
  try {
    logId = await log.start({ template, to, subjectId: opts.subjectId ?? null });
    logged = true;
  } catch {
    console.error('[email] could not write email_log');
  }
  if (logged && logId === null) return { ok: false, status: 'failed', error: 'already claimed' };

  const finish = async (status: 'sent' | 'failed', error: string | null): Promise<SendResult> => {
    if (logId) await log.finish(logId, status, error).catch(() => console.error('[email] could not update email_log'));
    if (status === 'failed') console.error('[email] send failed:', template);
    return status === 'sent' ? { ok: true, status } : { ok: false, status, error: error ?? 'failed' };
  };

  try {
    const cfg = (deps.config ?? getConfig)();
    if (!cfg.emailFrom || (!cfg.resendApiKey && !deps.send)) return await finish('failed', 'email not configured');
    const r = renderEmail({ template, ...data } as EmailData);
    const send = deps.send ?? resendSender(cfg.resendApiKey as string);
    const { error } = await send({ from: cfg.emailFrom, to, subject: r.subject, html: r.html, text: r.text });
    if (error) return await finish('failed', short(error.message ?? 'send error'));
    return await finish('sent', null);
  } catch (err) {
    return await finish('failed', short(err instanceof Error ? err.name : 'error'));
  }
}

/** Emails every ADMIN_EMAILS address; one log row per recipient. Never throws. */
export async function notifyAdminsPaymentSubmitted(
  p: { requestId: string; userEmail: string | null; plan: string; amountUsd: number },
  deps: EmailDeps & { adminEmails?: string[]; siteUrl?: string } = {},
): Promise<SendResult[]> {
  try {
    const admins = deps.adminEmails ?? getConfig().adminEmails;
    if (!admins.length) return [];
    const { SITE_URL } = await import('../site');
    const adminUrl = `${deps.siteUrl ?? SITE_URL}/admin`;
    return await Promise.all(
      admins.map((to) =>
        sendEmail(
          'payment_submitted_admin',
          to,
          { userEmail: p.userEmail ?? 'a user', plan: p.plan, amountUsd: p.amountUsd, adminUrl },
          { subjectId: p.requestId },
          deps,
        ),
      ),
    );
  } catch {
    console.error('[email] admin notification failed');
    return [];
  }
}
