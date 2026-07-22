// Single source of truth for site identity + canonical origin, used by metadata,
// robots, sitemap, manifest and the OG image so they can never drift.

export const SITE_NAME = 'AI Procurement Copilot';
export const SITE_TAGLINE = 'Supplier Quotation Analysis';

// Honest, ~190-char description of what the app actually does today.
export const SITE_DESCRIPTION =
  'Upload supplier quotations and your purchase requisition. Get structured comparisons, deterministic scoring, and a ready-to-sign approval form — currencies normalized, risks flagged.';

/** Deployed production origin — the canonical host search engines should index. */
const PRODUCTION_URL = 'https://ai-procedurement-analyzer.vercel.app';

/**
 * Canonical origin (no trailing slash). Set NEXT_PUBLIC_SITE_URL to override
 * (e.g. once a custom domain exists); on Vercel preview builds it falls back to
 * the project's production URL, then to the deployed domain above. Drives
 * canonical URLs, OG tags, sitemap and robots — so those always emit absolute
 * production URLs rather than localhost, even when rendered locally.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : PRODUCTION_URL)
).replace(/\/+$/, '');
