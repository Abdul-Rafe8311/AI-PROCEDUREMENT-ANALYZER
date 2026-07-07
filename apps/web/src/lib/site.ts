// Single source of truth for site identity + canonical origin, used by metadata,
// robots, sitemap, manifest and the OG image so they can never drift.

export const SITE_NAME = 'AI Procurement Copilot';
export const SITE_TAGLINE = 'Compare Supplier Quotations Automatically';

// Honest, ~150-char description of what the app actually does today.
export const SITE_DESCRIPTION =
  'Upload supplier quotations and get an automatic side-by-side comparison, risk detection, and a data-backed recommendation — with downloadable reports. Free, no account required.';

/**
 * Canonical origin (no trailing slash). Set NEXT_PUBLIC_SITE_URL to your real
 * domain in production; on Vercel it falls back to the project's production URL,
 * and to localhost in dev. Drives canonical URLs, OG tags, sitemap and robots.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')
).replace(/\/+$/, '');
