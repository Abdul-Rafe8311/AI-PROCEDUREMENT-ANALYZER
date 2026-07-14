import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, extractTranslationNotes } from './extraction-server';

test('detectLanguage: fully-Arabic quotation → "ar" (needs translation)', () => {
  const ar =
    'عرض سعر من شركة النجم لتوريد مراسي الأفران، الكمية عشرة آلاف قطعة، السعر خمسة عشر ريالاً للقطعة، التسليم خلال ثمانية أسابيع.';
  assert.equal(detectLanguage(ar), 'ar');
  // Arabic prose with English codes/currency still reads as Arabic.
  assert.equal(detectLanguage(`${ar}  REF: WS/QM/06/26-117  SAR 15.00  REVA-W.10-200`), 'ar');
});

test('detectLanguage: English document → "en" (no translation)', () => {
  assert.equal(detectLanguage('Quotation from Al Najim — anchors, qty 10000, SAR 15.00, delivery 8 weeks.'), 'en');
  // A stray Arabic currency mark does not flip an English doc.
  assert.equal(detectLanguage('Anchor REVA-W.10-200 qty 10000 unit price 10.36 ﷼'), 'en');
});

test('detectLanguage: bilingual document → "bilingual" (already has English, no translation)', () => {
  const bi =
    'عرض سعر Quotation — المرساة Anchor — الكمية Quantity 10000 — السعر Unit Price — ريال SAR — التسليم Delivery — شروط الدفع Payment Terms';
  assert.equal(detectLanguage(bi), 'bilingual');
});

test('extractTranslationNotes: collects the translator flags, de-duplicated', () => {
  const english =
    'Anchor, corrugated [untranslated: كباس] 10000 pcs at SAR 15.00.\nDelivery [ambiguous: خلال المدة] weeks.\nAnother [untranslated: كباس] line.';
  const notes = extractTranslationNotes(english);
  assert.equal(notes.length, 2);
  assert.ok(notes.includes('[untranslated: كباس]'));
  assert.ok(notes.some((n) => /ambiguous/.test(n)));
  // Clean translations carry no flags.
  assert.deepEqual(extractTranslationNotes('Anchor, corrugated, 10000 pcs at SAR 15.00.'), []);
});
