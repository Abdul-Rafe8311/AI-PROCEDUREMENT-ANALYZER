// guard: public
// GET /llms.txt (rewritten to /api/llms in next.config.mjs): public, plain-text summary for ChatGPT, Claude, Perplexity and other LLM crawlers.
// A route (not a static file) so the domain and prices follow SITE_URL / PLAN_PRICES_USD.
import { buildLlmsTxt } from '@/lib/llms-txt';
import { getPublicPrices } from '@/lib/server/public-prices';

export const revalidate = 3600;

export function GET() {
  return new Response(buildLlmsTxt(getPublicPrices()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
