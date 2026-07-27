// The routing decision is a pure function of the document's own text, so it is
// asserted directly — no model call, no credit spend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeDocument, isClaudeRequired } from './document-router';

const english = (n = 400) => 'Quotation for refractory castable, price per ton. '.repeat(Math.ceil(n / 50)).slice(0, n);
const arabic = 'عرض سعر للمواد الحرارية بسعر الطن الواحد شامل التوصيل إلى جدة. '.repeat(8);

test('ROUTER: an ordinary digital English document goes to Groq', () => {
  const r = routeDocument(english(), 'LE_002.pdf');
  assert.equal(r.provider, 'groq');
  assert.equal(r.reason, 'digital-text');
  assert.equal(r.language, 'en');
  assert.match(r.label, /Extracted via Groq/);
});

test('ROUTER: an Arabic document stays on Claude even with a good text layer', () => {
  const r = routeDocument(arabic, 'arabic-offer.pdf');
  assert.equal(r.provider, 'claude');
  assert.equal(r.reason, 'needs-translation');
  assert.equal(r.language, 'ar');
  assert.ok(isClaudeRequired(r));
});

test('ROUTER: a bilingual document stays on Claude (translation path)', () => {
  const r = routeDocument(`${arabic}\n${english()}`, 'bilingual.pdf');
  assert.equal(r.language, 'bilingual');
  assert.equal(r.provider, 'claude');
  assert.equal(r.reason, 'needs-translation');
});

test('ROUTER: no text layer at all → Claude (vision required)', () => {
  const r = routeDocument('', 'scan.pdf');
  assert.equal(r.provider, 'claude');
  assert.equal(r.reason, 'scanned-no-text-layer');
  assert.equal(r.textLength, 0);
});

test('ROUTER: letterhead-only OCR noise is NOT a text layer — the 200-char floor', () => {
  // A scanned page often yields a few dozen chars of letterhead. That must not be
  // mistaken for a readable document and sent to a text-only model.
  const r = routeDocument('KROSAKI MEA Ltd.\nNicosia, Cyprus\nOFFER', 'scanned-offer.pdf');
  assert.equal(r.provider, 'claude');
  assert.equal(r.reason, 'scanned-no-text-layer');
  assert.ok(r.textLength < 200);
  // …and the boundary is exact: 200 trimmed chars passes, 199 does not.
  const exact = (n: number) => 'a'.repeat(n);
  assert.equal(routeDocument(exact(200), 'x.pdf').provider, 'groq');
  assert.equal(routeDocument(exact(199), 'x.pdf').provider, 'claude');
});

test('ROUTER: the decision is deterministic — same input, same answer', () => {
  const a = routeDocument(english(), 'q.pdf');
  const b = routeDocument(english(), 'q.pdf');
  assert.deepEqual(a, b, 'so one decision can be reused by both consumers');
});

test('ROUTER: the label names the provider and why, for the provenance line', () => {
  assert.match(routeDocument(english(), 'q.pdf').label, /Groq \(digital English document\)/);
  assert.match(routeDocument('', 'q.pdf').label, /Claude \(scanned document — vision required\)/);
  assert.match(routeDocument(arabic, 'q.pdf').label, /Claude \(Arabic source — translation required\)/);
});
