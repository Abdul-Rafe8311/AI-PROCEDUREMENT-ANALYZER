// Response builders for /api/admin/users, with injectable deps for tests.
import { NextResponse } from 'next/server';
import {
  adminSetPlan,
  InvalidAdminPlanError,
  listUsersWithPlans,
  userExists,
  type AdminUserRow,
} from './db';
import type { Principal } from './guard';

export interface AdminUsersDeps {
  listUsers?: (search: string, now: Date) => Promise<AdminUserRow[]>;
  userExists?: (userId: string) => Promise<boolean>;
  setPlan?: (args: { userId: string; plan: string; endsAt: string; adminEmail: string }) => Promise<string>;
  now?: () => Date;
}

const headers = { 'Cache-Control': 'no-store' };
const PLANS = ['plus', 'pro', 'max'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unavailable = () =>
  NextResponse.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503, headers });

const validation = (fields: Record<string, string>) =>
  NextResponse.json({ error: 'Invalid input.', code: 'VALIDATION', fields }, { status: 400, headers });

export interface ValidBody {
  userId: string;
  plan: string;
  endsAt: string;
}

export function validateOverride(
  body: unknown,
  now: Date,
): { ok: true; value: ValidBody } | { ok: false; fields: Record<string, string> } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (typeof b.userId !== 'string' || !UUID.test(b.userId)) fields.userId = 'A valid user id is required.';
  if (typeof b.plan !== 'string' || !PLANS.includes(b.plan)) fields.plan = 'Plan must be plus, pro or max.';
  let endsAt = '';
  if (typeof b.endsAt !== 'string' || !b.endsAt.trim() || Number.isNaN(Date.parse(b.endsAt))) {
    fields.endsAt = 'endsAt must be an ISO date-time.';
  } else if (Date.parse(b.endsAt) <= now.getTime()) {
    fields.endsAt = 'endsAt must be in the future.';
  } else {
    endsAt = new Date(b.endsAt).toISOString();
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { userId: b.userId as string, plan: b.plan as string, endsAt } };
}

export async function buildAdminUsersGet(req: Request, deps: AdminUsersDeps = {}): Promise<Response> {
  const now = (deps.now ?? (() => new Date()))();
  const search = new URL(req.url).searchParams.get('search') ?? '';
  try {
    const rows = await (deps.listUsers ?? listUsersWithPlans)(search, now);
    return NextResponse.json({ users: rows }, { headers });
  } catch (err) {
    console.error('[admin-users] list failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}

export async function buildAdminUsersPost(
  req: Request,
  principal: Principal,
  deps: AdminUsersDeps = {},
): Promise<Response> {
  const now = (deps.now ?? (() => new Date()))();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const v = validateOverride(body, now);
  if (!v.ok) return validation(v.fields);
  const adminEmail = principal.email ?? '';
  if (!adminEmail) {
    console.error('[admin-users] principal has no email');
    return unavailable();
  }
  try {
    const exists = await (deps.userExists ?? userExists)(v.value.userId);
    if (!exists) {
      return NextResponse.json({ error: 'User not found.', code: 'NOT_FOUND' }, { status: 404, headers });
    }
    const periodId = await (deps.setPlan ?? adminSetPlan)({ ...v.value, adminEmail });
    return NextResponse.json({ periodId, plan: v.value.plan, endsAt: v.value.endsAt }, { headers });
  } catch (err) {
    if (err instanceof InvalidAdminPlanError) {
      const field = err.reason === 'invalid_plan' ? 'plan' : 'endsAt';
      return validation({ [field]: err.reason === 'invalid_plan' ? 'Unknown plan.' : 'endsAt must be in the future.' });
    }
    console.error('[admin-users] override failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}
