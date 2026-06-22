export interface AppConfig {
  env: string;
  port: number;
  corsOrigin: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    resetSecret: string;
    accessExpires: string;
    refreshExpires: string;
    resetExpires: string;
  };
  openai: {
    apiKey: string;
    model: string;
    embeddingModel: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
    bucket: string;
  };
  rateLimit: {
    ttl: number;
    max: number;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  // PORT is injected by most hosts (Railway/Render/Fly); fall back to API_PORT.
  port: parseInt(process.env.PORT ?? process.env.API_PORT ?? '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_change_me',
    resetSecret: process.env.JWT_RESET_SECRET ?? 'dev_reset_secret_change_me',
    accessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES ?? '7d',
    resetExpires: process.env.JWT_RESET_EXPIRES ?? '30m',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },
  supabase: {
    // No silent fallback — StorageService validates these and fails fast.
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    // Single source of truth for the storage bucket name.
    bucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'quotations',
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
  },
});
