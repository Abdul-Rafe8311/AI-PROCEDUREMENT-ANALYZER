// guard: cron
import { NextResponse } from 'next/server';
import { requireCron } from '@/lib/server/guard';
import { runDailyJob } from '@/lib/server/daily-job';
import { supabaseExpiryStore, supabaseRetentionStore } from '@/lib/server/daily-job-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const g = requireCron(req);
  if (!g.ok) return g.response;
  try {
    const result = await runDailyJob(new Date(), { expiry: supabaseExpiryStore(), retention: supabaseRetentionStore() });
    const failed = 'error' in result.reminders || 'error' in result.retention;
    // 500 when a task blew up so the failure shows in Vercel's cron log; the other task still ran.
    return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 });
  } catch {
    console.error('[cron] daily job unavailable');
    return NextResponse.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
