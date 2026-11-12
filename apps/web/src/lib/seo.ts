// SEO + GEO helpers: per-page metadata, JSON-LD builders and the home-page FAQ. Pure (no env reads
// besides SITE_URL via ./site) so it is unit-testable. Prices are passed in, never read here.
import type { Metadata } from 'next';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from './site';
import { PLAN_NAMES, type PlanPrices } from './plan-matrix';
import { PLAN_IDS, planQuota, hasChatAccess, hasTenderSheetAccess } from './entitlements/plans';
import { DEFAULT_WEIGHTS } from './workspace-types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const w = DEFAULT_WEIGHTS;

/** Product summary an AI engine can quote verbatim. */
export const PRODUCT_SUMMARY =
  `${SITE_NAME} is supplier quotation comparison software for procurement teams, including GCC and Saudi Arabia procurement teams. ` +
  'It reads supplier quotations (PDF, Word or image), compares them side by side, flags risks, and fills in the technical approval (TA) form.';

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQS: FaqItem[] = [
  {
    q: 'What does AI Procurement Copilot do?',
    a: 'It is AI procurement software for supplier quotation comparison. You upload quotations from several suppliers and, optionally, your purchase requisition. It extracts prices, delivery times, payment terms and warranty, normalizes currencies, compares suppliers side by side, flags risks, and produces a recommendation, a report and a technical approval (TA) form.',
  },
  {
    q: 'Who is it for?',
    a: 'Procurement, purchasing and planning teams that compare RFQ responses by hand, in industries such as construction, contracting, manufacturing and trading. It is built with GCC and Saudi procurement teams in mind, including bilingual quotations.',
  },
  {
    q: 'How does supplier scoring work?',
    a: `Each supplier gets a score from 0 to 100 using fixed, deterministic rules rather than an AI opinion. By default the weights are price ${pct(w.price)}, delivery time ${pct(w.delivery)}, payment terms ${pct(w.payment)}, warranty ${pct(w.warranty)} and risk ${pct(w.risk)}. The same inputs always give the same score, and risks such as long lead times, short payment terms, missing warranty and price outliers are listed alongside it.`,
  },
  {
    q: 'Which file types are supported?',
    a: 'PDF, Word (DOCX), PNG and JPG files, including scanned quotations and photos. Your purchase requisition can be uploaded in the same formats.',
  },
  {
    q: 'What is a technical approval (TA) form and can the tool fill it in?',
    a: 'A TA form records the supplier chosen for a purchase request and why. When you upload your purchase requisition, the tool matches supplier line items to it, flags specification mismatches, and exports a pre-filled technical approval form as a PDF that is ready to sign.',
  },
  {
    q: 'How much does it cost?',
    a: `There is a free plan. Paid plans are Plus, Pro and Max. Monthly PDF allowances are ${PLAN_IDS.map((id) => `${PLAN_NAMES[id]} ${planQuota(id)}`).join(', ')}. The chatbox is included from Plus and the tender sheet from Pro. Current prices are listed in the pricing section of the home page.`,
  },
  {
    q: 'How do I pay?',
    a: 'Payment is by bank transfer. Choose a plan, transfer the amount using the bank details shown at checkout, upload a screenshot of the transfer as proof, and your plan is activated once the payment is verified. There is no card payment.',
  },
  {
    q: 'What happens to my data?',
    a: 'We never sell your data. Your quotation files are used only to generate your analysis and are never shared with other customers. Your quotations and analyses are tied to your own account. Quotation text is extracted using the Anthropic Claude API. Payment proof screenshots are deleted automatically after 12 months.',
  },
];

interface PageSeo {
  title: string;
  description: string;
  path: string;
  /** Default true; set false for pages that must stay out of search results. */
  index?: boolean;
}

/**
 * Full per-page metadata: unique title, description, canonical, Open Graph and Twitter card.
 * A page-level openGraph replaces the layout's wholesale, so everything is repeated here. Images are set explicitly
 * (absolute, from SITE_URL) because a deeper segment's openGraph would otherwise drop the root file-based image.
 */
const OG_IMAGE = { url: absoluteUrl('/opengraph-image'), width: 1200, height: 630, alt: `${SITE_NAME} — supplier quotation comparison` };

export function pageMetadata({ title, description, path, index = true }: PageSeo): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: 'website',
      url: absoluteUrl(path),
      siteName: SITE_NAME,
      locale: 'en_US',
      title,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}

export const SITE_KEYWORDS = [
  'supplier quotation comparison',
  'AI procurement software',
  'RFQ comparison tool',
  'bid comparison',
  'technical approval (TA) form',
  'procurement software Saudi Arabia',
  'GCC procurement',
  'quotation analysis',
  'purchase requisition matching',
  'procurement risk detection',
];

export const organizationJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: absoluteUrl('/apple-icon'),
  description: SITE_DESCRIPTION,
});

export const websiteJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: 'en',
  publisher: { '@id': `${SITE_URL}/#organization` },
});

/** Offers come from the configured plan prices; a paid plan with no known price is left out, never guessed. */
export function softwareJsonLd(prices: PlanPrices | null) {
  const offers = PLAN_IDS.flatMap((id) => {
    const price = id === 'free' ? 0 : prices?.[id];
    if (typeof price !== 'number' || !Number.isFinite(price)) return [];
    const features = [`${planQuota(id)} PDFs per month`, hasChatAccess(id) ? 'Chatbox' : null, hasTenderSheetAccess(id) ? 'Tender sheet' : null];
    return [
      {
        '@type': 'Offer',
        name: `${PLAN_NAMES[id]} plan`,
        description: features.filter(Boolean).join(', '),
        price: String(price),
        priceCurrency: 'USD',
        url: absoluteUrl('/#pricing'),
        availability: 'https://schema.org/InStock',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: String(price),
          priceCurrency: 'USD',
          unitCode: 'MON',
          billingDuration: 1,
        },
      },
    ];
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: PRODUCT_SUMMARY,
    featureList: [
      'Supplier quotation comparison',
      'AI extraction from PDF, DOCX, PNG and JPG quotations',
      'Deterministic 0-100 supplier scoring',
      'Risk detection',
      'Purchase requisition matching',
      'Technical approval (TA) form export',
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
    ...(offers.length ? { offers } : {}),
  };
}

export const faqJsonLd = (items: FaqItem[] = FAQS) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

/** Serialize for a <script type="application/ld+json">; escapes "<" so content can never close the tag. */
export const jsonLdString = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');
