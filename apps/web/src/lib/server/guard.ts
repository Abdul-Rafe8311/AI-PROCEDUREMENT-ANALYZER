// Guard-then-handle (AD-1). requirePrincipal verifies the Bearer token once per
// request with supabase.auth.getUser; identity is never read from body/query.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ConfigError, getConfig, type ServerConfig } from './config';

export interface Principal {
  userId: string;
  email: string | null;
  via: 'jwt';
  demo?: true;
}

export type GuardResult = { ok: true; principal: Principal } | { ok: false; response: Response };

export interface VerifiedUser {
  id: string;
  email?: string | null;
}

export interface GuardDeps {
  config?: () => Pick<ServerConfig, 'production' | 'supabaseUrl' | 'supabaseAnonKey'>;
  verify?: (token: string) => Promise<{ user: VerifiedUser | null; error: unknown }>;
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
  if (!hasUrl && !hasKey && !cfg.production) {
    return { ok: true, principal: { ...DEMO_PRINCIPAL } };
  }
  if (!hasUrl || !hasKey) {
    console.error('[guard] Supabase configuration missing or incomplete');
    return { ok: false, response: reply(503, 'Service is not configured.', 'SERVICE_UNAVAILABLE') };
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
