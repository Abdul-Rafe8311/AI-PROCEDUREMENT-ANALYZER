// Builds the /llms.txt body: a plain-English product summary for LLM crawlers (llmstxt.org format).
import { PLAN_NAMES, type PlanPrices } from './plan-matrix';
import { PLAN_IDS, hasChatAccess, hasTenderSheetAccess, planQuota } from './entitlements/plans';
import { FAQS, PRODUCT_SUMMARY } from './seo';
import { SITE_NAME, absoluteUrl } from './site';

export function buildLlmsTxt(prices: PlanPrices | null): string {
  const plans = PLAN_IDS.map((id) => {
    const price = id === 'free' ? 0 : prices?.[id];
    const cost = typeof price === 'number' ? `USD ${price}/month` : 'price on the pricing page';
    const extras = [hasChatAccess(id) && 'chatbox', hasTenderSheetAccess(id) && 'tender sheet'].filter(Boolean).join(', ');
    return `- ${PLAN_NAMES[id]}: ${cost}, ${planQuota(id)} PDFs per month${extras ? `, ${extras}` : ''}`;
  });
  return `# ${SITE_NAME}

> ${PRODUCT_SUMMARY}

## What it does
- Reads supplier quotations in PDF, Word (DOCX), PNG and JPG formats, including scans and Arabic or English documents.
- Extracts price, delivery time, payment terms, warranty and currency, and normalizes currencies for a like-for-like bid comparison.
- Scores each supplier from 0 to 100 with deterministic rules (default weights: price 40%, delivery 25%, payment terms 15%, warranty 10%, risk 10%) and flags risks.
- Matches supplier line items to the buyer's purchase requisition and exports a pre-filled technical approval (TA) form as PDF.
- Produces a decision report, and lets you chat with your quotations on paid plans.

## Who it is for
Procurement, purchasing and planning teams, including GCC and Saudi Arabia procurement teams, in construction, contracting, manufacturing and trading.

## Pricing
${plans.join('\n')}
Payment is by bank transfer with proof upload; there is no card payment.

## Key pages
- [Home](${absoluteUrl('/')}): product overview and demo
- [Pricing](${absoluteUrl('/#pricing')}): plans and prices
- [FAQ](${absoluteUrl('/#faq')}): common questions
- [Sign up](${absoluteUrl('/signup')}): create a free account
- [Sign in](${absoluteUrl('/login')})

## FAQ
${FAQS.map((f) => `- ${f.q} ${f.a}`).join('\n')}
`;
}
