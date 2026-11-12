import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Account-only or auth-gated routes. /plans itself is left crawlable so its noindex tag is seen.
// Password-reset screens carry noindex too; /login and /signup are public and indexable.
const PRIVATE_PATHS = ['/admin', '/api/', '/workspace', '/plans/pay', '/forgot-password', '/reset-password'];

// Search and AI crawlers named explicitly. A crawler with its own group ignores the '*' group, so
// each one repeats the same disallows.
const AI_CRAWLERS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: PRIVATE_PATHS },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
