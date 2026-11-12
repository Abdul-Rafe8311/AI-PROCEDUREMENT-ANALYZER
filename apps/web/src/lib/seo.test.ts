import test from 'node:test';
import assert from 'node:assert/strict';
import { FAQS, faqJsonLd, jsonLdString, pageMetadata, softwareJsonLd } from './seo';
import { buildLlmsTxt } from './llms-txt';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { SITE_URL } from './site';

test('pageMetadata: canonical, OG and Twitter all set; absolute OG url', () => {
  const m = pageMetadata({ title: 'T', description: 'D', path: '/signup' });
  assert.equal(m.alternates?.canonical, '/signup');
  assert.equal((m.openGraph as { url: string }).url, `${SITE_URL}/signup`);
  assert.equal((m.twitter as { card: string }).card, 'summary_large_image');
  assert.deepEqual(m.robots, { index: true, follow: true });
});

test('softwareJsonLd: offers from prices; unknown paid price is omitted, never guessed', () => {
  const ld = softwareJsonLd({ plus: 19, pro: null, max: 99 }) as { offers: { name: string; price: string }[] };
  assert.deepEqual(ld.offers.map((o) => [o.name, o.price]), [['Free plan', '0'], ['Plus plan', '19'], ['Max plan', '99']]);
  const none = softwareJsonLd(null) as { offers: unknown[] };
  assert.equal(none.offers.length, 1);
});

test('FAQ: 6-8 items, JSON-LD mirrors them, "<" is escaped', () => {
  assert.ok(FAQS.length >= 6 && FAQS.length <= 8);
  assert.equal(faqJsonLd().mainEntity.length, FAQS.length);
  assert.ok(!jsonLdString({ a: '</script>' }).includes('<'));
});

test('robots: private paths blocked for everyone, AI crawlers allowed on public pages', () => {
  const rules = robots().rules as { userAgent: string | string[]; allow: string; disallow: string[] }[];
  const agents = rules.flatMap((r) => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]));
  for (const a of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.ok(agents.includes(a), a);
  for (const r of rules) {
    assert.equal(r.allow, '/');
    for (const p of ['/admin', '/api/', '/workspace', '/plans/pay']) assert.ok(r.disallow.includes(p), p);
    assert.ok(!r.disallow.includes('/login') && !r.disallow.includes('/signup'));
  }
});

test('sitemap: public pages only, absolute URLs', () => {
  const urls = sitemap().map((s) => s.url);
  assert.deepEqual(urls, [`${SITE_URL}/`, `${SITE_URL}/signup`, `${SITE_URL}/login`]);
});

test('llms.txt: links use SITE_URL, prices shown when known', () => {
  const t = buildLlmsTxt({ plus: 19, pro: 49, max: 99 });
  assert.ok(t.startsWith('# AI Procurement Copilot'));
  assert.ok(t.includes(`${SITE_URL}/signup`));
  assert.ok(t.includes('Pro: USD 49/month'));
});

test('privacy FAQ: same text in the home FAQ, FAQPage JSON-LD and llms.txt', () => {
  const claim = 'We never sell your data. Your quotation files are used only to generate your analysis and are never shared with other customers.';
  const item = FAQS.find((f) => f.q === 'What happens to my data?');
  assert.ok(item?.a.startsWith(claim));
  assert.ok(item?.a.includes('Anthropic Claude API') && item?.a.includes('12 months'));
  assert.ok(JSON.stringify(faqJsonLd()).includes(claim));
  assert.ok(buildLlmsTxt(null).includes(claim));
});
