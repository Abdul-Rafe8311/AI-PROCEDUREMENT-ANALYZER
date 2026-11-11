// Guard-then-handle (AD-1). requirePrincipal verifies the Bearer token once per
// request with supabase.auth.getUser; identity is never read from body/query.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ConfigError, getConfig, type ServerConfig } from './config';
import { hashApiKey, lookupApiKeyUser } from './api-keys';

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
