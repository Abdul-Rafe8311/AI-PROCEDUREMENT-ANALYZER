// Quota gate for /api/extract (AD-5). Wraps the route: reserve -> extract -> confirm or release.
// analysis-engine.ts and extraction-server.ts stay untouched.
import { NextResponse } from 'next/server';
import { quotaWindow } from '../entitlements/quota-window';
import type { PlanPeriod } from '../entitlements/effective-plan';
import { loadPeriods } from './db';
import { confirmPdfUsage, releasePdfUsage, reservePdfQuota, type ReserveResult } from './usage';
import type { Principal } from './guard';

export interface QuotaDeps {
  loadPeriods?: (userId: string, now: Date) => Promise<PlanPeriod[]>;
  reserve?: typeof reservePdfQuota;
  confirm?: typeof confirmPdfUsage;
  release?: typeof releasePdfUsage;
  now?: () => Date;
}

/** What the route must settle after extraction. `reserved` are the hashes this request is charged for. */
export interface QuotaTicket {
  userId: string;
  windowStart: Date;
  reserved: string[];
}

export type ReserveOutcome = { ok: true; ticket: QuotaTicket | null } | { ok: false; response: Response };

const headers = { 'Cache-Control': 'no-store' };

/** Reserves quota for the distinct quotation-file hashes. The PR file is never passed in. */
export async function reserveForExtract(
  principal: Principal,
  hashes: string[],
  deps: QuotaDeps = {},
): Promise<ReserveOutcome> {
  if (principal.demo || hashes.length === 0) return { ok: true, ticket: null };
  const now = deps.now ?? (() => new Date());
  try {
    let result: ReserveResult | null = null;
    let window = quotaWindow([], now());
    for (let attempt = 0; attempt < 2; attempt++) {
      const periods = await (deps.loadPeriods ?? loadPeriods)(principal.userId, now());
      window = quotaWindow(periods, now());
      result = await (deps.reserve ?? reservePdfQuota)({
        userId: principal.userId,
        hashes,
        windowStart: window.windowStart,
        quota: window.quota,
        expectedPeriodId: window.periodId,
      });
      if (result.status !== 'STALE') break;
    }
    if (!result || result.status === 'STALE') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Your plan just changed. Please try again.', code: 'SERVICE_UNAVAILABLE' },
          { status: 503, headers },
        ),
      };
    }
    if (result.status === 'QUOTA_EXCEEDED') {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'Upload limit reached for your plan.',
            code: 'QUOTA_EXCEEDED',
            plan: window.plan,
            quota: result.quota,
            remaining: result.remaining,
            resetAt: window.resetAt.toISOString(),
          },
          { status: 429, headers },
        ),
      };
    }
    return { ok: true, ticket: { userId: principal.userId, windowStart: window.windowStart, reserved: result.reserved } };
  } catch (err) {
    console.error('[extract-quota] reserve failed:', err instanceof Error ? err.name : 'error');
    // Fail closed: no quota check means no extraction.
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Service unavailable. Please try again.', code: 'SERVICE_UNAVAILABLE' },
        { status: 503, headers },
      ),
    };
  }
}

/** Confirms reserved hashes that extracted successfully, releases the rest. Best effort, never throws. */
export async function settleExtract(
  ticket: QuotaTicket | null,
  succeeded: ReadonlySet<string>,
  deps: QuotaDeps = {},
): Promise<void> {
  if (!ticket) return;
  const confirm = deps.confirm ?? confirmPdfUsage;
  const release = deps.release ?? releasePdfUsage;
  const results = await Promise.allSettled(
    ticket.reserved.map((hash) =>
      succeeded.has(hash)
        ? confirm({ userId: ticket.userId, hash, windowStart: ticket.windowStart })
        : release({ userId: ticket.userId, hash }),
    ),
  );
  if (results.some((r) => r.status === 'rejected')) console.error('[extract-quota] settle partially failed');
}
