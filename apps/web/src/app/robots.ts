import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Auth-gated or account-only routes: nothing here is useful in search results, and
// /workspace only ever renders a redirect gate to a crawler. Kept in sync with the
// routes wrapped by <RequireAuth> and the (auth) route group.
const PRIVATE_PATHS = [
  '/workspace',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/api/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATHS }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
