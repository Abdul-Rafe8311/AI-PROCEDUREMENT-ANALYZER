// Guard-then-handle (AD-1). requirePrincipal verifies the Bearer token once per
// request with supabase.auth.getUser; identity is never read from body/query.
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ConfigError, getConfig, type ServerConfig } from './config';
import { hashApiKey, lookupApiKeyUser } from './api-keys';
import { loadPeriods } from './db';
import { effectivePlan, type PlanPeriod } from '../entitlements/effective-plan';
import { canUseFeature, featureRequiredPlan, type FeatureId } from '../entitlements/plans';

export interface Principal {
  userId: string;
  email: string | null;
  via: 'jwt' | 'api_key';
  demo?: true;
}

export type GuardResult = { ok: true; principal: Principal } | { ok: false; response: Response };

export interface VerifiedUser {
  id: string;
  email?: string | null;
}

export interface GuardDeps {
  config?: () => Pick<ServerConfig, 'production' | 'allowDemo' | 'supabaseUrl' | 'supabaseAnonKey'> &
    Partial<Pick<ServerConfig, 'adminEmails' | 'adminUserIds'>>;
  verify?: (token: string) => Promise<{ user: VerifiedUser | null; error: unknown }>;
  /** Only `apikey`-class routes set this (AD-2). Elsewhere `X-Api-Key` is ignored. */
  allowApiKey?: boolean;
  /** Maps a key's SHA-256 to its user id; null when unknown or revoked. */
  lookupApiKey?: (sha256: string) => Promise<string | null>;
}

export const DEMO_PRINCIPAL: Principal = {
  userId: 'demo-user',
  email: 'demo@example.com',
  via: 'jwt',
  demo: true,
};

const reply = (status: number, error: string, code: string) =>
  NextResponse.json({ error, code }, { status });

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export async function requirePrincipal(req: Request, deps: GuardDeps = {}): Promise<GuardResult> {
  let cfg;
  try {
    cfg = (deps.config ?? getConfig)();
  } catch (err) {
    if (err instanceof ConfigError) console.error('[guard] configuration error:', err.message);
    else console.error('[guard] configuration error');
    return { ok: false, response: reply(503, 'Service is not configured.', 'SERVICE_UNAVAILABLE') };
  }

  const hasUrl = Boolean(cfg.supabaseUrl);
  const hasKey = Boolean(cfg.supabaseAnonKey);
  if (!hasUrl && !hasKey && cfg.allowDemo && !cfg.production) {
    return { ok: true, principal: { ...DEMO_PRINCIPAL } };
  }
  if (!hasUrl || !hasKey) {
    console.error('[guard] Supabase configuration missing or incomplete');
    return { ok: false, response: reply(503, 'Service is not configured.', 'SERVICE_UNAVAILABLE') };
  }

  const rawKey = deps.allowApiKey ? req.headers.get('x-api-key')?.trim() : undefined;
  if (rawKey) {
    try {
      const userId = await (deps.lookupApiKey ?? lookupApiKeyUser)(hashApiKey(rawKey));
      if (!userId) return { ok: false, response: reply(401, 'Invalid API key.', 'UNAUTHENTICATED') };
      return { ok: true, principal: { userId, email: null, via: 'api_key' } };
    } catch {
      console.error('[guard] api key lookup failed');
      return { ok: false, response: reply(503, 'Service unavailable.', 'SERVICE_UNAVAILABLE') };
    }
  }

  const token = bearer(req);
  if (!token) return { ok: false, response: reply(401, 'Sign in required.', 'UNAUTHENTICATED') };

  const verify =
    deps.verify ??
    (async (t: string) => {
      const client = createClient(cfg.supabaseUrl as string, cfg.supabaseAnonKey as string, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.getUser(t);
      return { user: data?.user ?? null, error };
    });

  try {
    const { user, error } = await verify(token);
    if (error) {
      const e = error as { status?: number; name?: string };
      if ((typeof e.status === 'number' && e.status >= 500) || e.name === 'AuthRetryableFetchError') {
        console.error('[guard] token verification unavailable');
        return { ok: false, response: reply(503, 'Sign-in service unavailable.', 'SERVICE_UNAVAILABLE') };
      }
      return { ok: false, response: reply(401, 'Sign in required.', 'UNAUTHENTICATED') };
    }
    if (!user?.id) return { ok: false, response: reply(401, 'Sign in required.', 'UNAUTHENTICATED') };
    return { ok: true, principal: { userId: user.id, email: user.email ?? null, via: 'jwt' } };
  } catch {
    console.error('[guard] token verification failed');
    return { ok: false, response: reply(503, 'Sign-in service unavailable.', 'SERVICE_UNAVAILABLE') };
  }
}

/** Admin rule (AD-7): email in adminEmails AND user id in adminUserIds. Demo principal is never admin here. */
export function isAdminPrincipal(
  principal: Principal,
  cfg: Partial<Pick<ServerConfig, 'adminEmails' | 'adminUserIds'>>,
): boolean {
  if (principal.demo) return false;
  const email = principal.email?.toLowerCase() ?? null;
  const emails = (cfg.adminEmails ?? []).map((e) => e.toLowerCase());
  const ids = cfg.adminUserIds ?? [];
  return Boolean(email && emails.includes(email) && ids.includes(principal.userId));
}

/** Admin guard (AD-7): principal email in ADMIN_EMAILS AND user id in ADMIN_USER_IDS. */
export async function requireAdmin(req: Request, deps: GuardDeps = {}): Promise<GuardResult> {
  const g = await requirePrincipal(req, deps);
  if (!g.ok) return g;
  if (g.principal.demo) return g;
  let cfg;
  try {
    cfg = (deps.config ?? getConfig)();
  } catch {
    console.error('[guard] configuration error');
    return { ok: false, response: reply(503, 'Service is not configured.', 'SERVICE_UNAVAILABLE') };
  }
  if (isAdminPrincipal(g.principal, cfg)) return g;
  return { ok: false, response: reply(403, 'Admin access required.', 'FORBIDDEN') };
}

export interface FeatureDeps extends GuardDeps {
  loadPeriods?: (userId: string, now: Date) => Promise<PlanPeriod[]>;
  now?: () => Date;
}

/**
 * Feature guard (AD-4): verified principal, then one fresh periods query per request.
 * Nothing is cached, so a plan change applies on the very next call.
 */
export async function requireFeature(req: Request, feature: FeatureId, deps: FeatureDeps = {}): Promise<GuardResult> {
  const g = await requirePrincipal(req, deps);
  if (!g.ok) return g;
  if (g.principal.demo) return g; // demo mode is the Max plan (AD-1)
  const now = (deps.now ?? (() => new Date()))();
  let plan;
  try {
    plan = effectivePlan(await (deps.loadPeriods ?? loadPeriods)(g.principal.userId, now), now);
  } catch {
    console.error('[guard] plan lookup failed');
    return { ok: false, response: reply(503, 'Service unavailable.', 'SERVICE_UNAVAILABLE') };
  }
  if (canUseFeature(plan, feature)) return g;
  const requiredPlan = featureRequiredPlan(feature);
  return {
    ok: false,
    response: NextResponse.json(
      { error: `This feature needs the ${requiredPlan} plan or higher.`, code: 'PLAN_REQUIRED', feature, requiredPlan },
      { status: 403 },
    ),
  };
}

export interface CronDeps {
  secret?: () => string | null;
}

/** Constant-time compare: hashing first makes both sides the same length. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/**
 * Cron guard: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it). No user principal exists.
 * Missing or wrong header is 401; an unset secret is 503, never open.
 */
export function requireCron(req: Request, deps: CronDeps = {}): { ok: true } | { ok: false; response: Response } {
  let secret: string | null;
  try {
    secret = (deps.secret ?? (() => getConfig().cronSecret))();
  } catch {
    console.error('[guard] configuration error');
    return { ok: false, response: reply(503, 'Service is not configured.', 'SERVICE_UNAVAILABLE') };
  }
  if (!secret) {
    console.error('[guard] CRON_SECRET is not set');
    return { ok: false, response: reply(503, 'Service is not configured.', 'SERVICE_UNAVAILABLE') };
  }
  const token = bearer(req);
  if (!token || !safeEqual(token, secret)) return { ok: false, response: reply(401, 'Unauthorized.', 'UNAUTHENTICATED') };
  return { ok: true };
}
