// Server-only configuration. The sole process.env reader for new code: it
// validates once and fails closed in production (AD-1, AD-12).
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ServerConfig {
  production: boolean;
  /** ALLOW_DEMO=true, explicit opt-in for the synthetic demo principal. Independent of NODE_ENV. */
  allowDemo: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  adminEmails: string[];
  adminUserIds: string[];
  supportEmail: string | null;
  bankDetails: unknown | null;
  planPricesUsd: unknown | null;
  resendApiKey: string | null;
  emailFrom: string | null;
  turnstileSecretKey: string | null;
  turnstileSiteKey: string | null;
  cronSecret: string | null;
}

type Env = Record<string, string | undefined>;

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const list = (v: string | undefined) =>
  (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function json(name: string, v: string | undefined, errors: string[]): unknown | null {
  const s = str(v);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    errors.push(`${name} is not valid JSON`);
    return null;
  }
}

export function loadConfig(env: Env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const cfg: ServerConfig = {
    production,
    allowDemo: env.ALLOW_DEMO === 'true',
    supabaseUrl: str(env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: str(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: str(env.SUPABASE_SERVICE_ROLE_KEY),
    adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    adminUserIds: list(env.ADMIN_USER_IDS),
    supportEmail: str(env.SUPPORT_EMAIL),
    bankDetails: json('BANK_DETAILS', env.BANK_DETAILS, errors),
    planPricesUsd: json('PLAN_PRICES_USD', env.PLAN_PRICES_USD, errors),
    resendApiKey: str(env.RESEND_API_KEY),
    emailFrom: str(env.EMAIL_FROM),
    turnstileSecretKey: str(env.TURNSTILE_SECRET_KEY),
    turnstileSiteKey: str(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    cronSecret: str(env.CRON_SECRET),
  };
  if (production) {
    if (cfg.allowDemo) errors.push('ALLOW_DEMO must not be set in production');
    if (!cfg.supabaseUrl) errors.push('NEXT_PUBLIC_SUPABASE_URL is missing');
    if (!cfg.supabaseAnonKey) errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');
    if (errors.length) throw new ConfigError(errors.join('; '));
  } else if (errors.length) {
    console.error('[config] ' + errors.join('; '));
  }
  return cfg;
}

let memo: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (!memo) memo = loadConfig(process.env);
  return memo;
}

/** Test hook. */
export function resetConfigForTests() {
  memo = null;
}
