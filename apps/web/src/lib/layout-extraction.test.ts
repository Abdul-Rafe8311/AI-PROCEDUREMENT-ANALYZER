import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructPage } from './extraction-server';

// A pdf.js text item: str + affine transform ([a,b,c,d,x,y]) + width. Font height
// is d (transform[3]); baseline Y is transform[5]; left X is transform[4].
const item = (str: string, x: number, y: number, w: number, h = 11) => ({
  str,
  transform: [h, 0, 0, h, x, y],
  width: w,
  height: h,
});

// The five PR 12601612 rows, described by cell.
const ROWS = [
  { code: '404602703004', desc: 'Corrugated anchor TWS.10(60)-200(140)-40-253 Grade 253 MA', qty: '10000', uom: 'PCS' },
  { code: '404602701007', desc: 'SS 310 anchor Type: V DRG NO.NCC-KL-42', qty: '2000', uom: 'PCS' },
  { code: '404602703033', desc: 'Corrugated anchor TWS.10(60)-250(140)-40-253 Grade 253 MA', qty: '1500', uom: 'PCS' },
  { code: '404602703042', desc: 'Corrugated anchor TWS.10(60)-170(80)-40-253 Grade 253 MA', qty: '300', uom: 'PCS' },
  { code: '404602703043', desc: 'Corrugated anchor TWS.10(60)-180(100)-40-253 Grade 253 MA', qty: '700', uom: 'PCS' },
];
const COL_X = { code: 40, desc: 165, qty: 470, uom: 545 };
const rowY = (r: number) => 600 - r * 34; // pdf y grows upward → top row highest

test('reconstructPage: column-scattered table is reassembled into one line per row', () => {
  // Emit items COLUMN-MAJOR (all codes, then all descriptions, then all qtys, then
  // all uoms) — the real failure mode where flat text loses row structure.
  const items: ReturnType<typeof item>[] = [];
  ROWS.forEach((row, r) => items.push(item(row.code, COL_X.code, rowY(r), 60)));
  ROWS.forEach((row, r) => items.push(item(row.desc, COL_X.desc, rowY(r), 280)));
  ROWS.forEach((row, r) => items.push(item(row.qty, COL_X.qty, rowY(r), 26)));
  ROWS.forEach((row, r) => items.push(item(row.uom, COL_X.uom, rowY(r), 22)));

  const out = reconstructPage(items);
  const lines = out.split('\n');
  assert.equal(lines.length, 5, `expected 5 rows, got ${lines.length}:\n${out}`);

  // Each reconstructed line must carry its OWN code, qty and uom together.
  ROWS.forEach((row, r) => {
    const line = lines[r];
    assert.ok(line.includes(row.code), `row ${r} missing code ${row.code}: "${line}"`);
    assert.ok(line.includes(row.qty), `row ${r} missing qty ${row.qty}: "${line}"`);
    // code precedes qty on the line (columns ordered by X)
    assert.ok(line.indexOf(row.code) < line.indexOf(row.qty), `row ${r} code/qty out of order: "${line}"`);
  });
});

test('reconstructPage: glued numeric cells come back apart as separate tokens', () => {
  // Numbers that flat extraction concatenates ("10000قطعة0.0510.36103,578.03") are
  // separate positioned runs → reconstruction must keep them space-separated.
  const y = 500;
  const items = [
    item('404602703004', 480, y, 60),
    item('10000', 226, y, 25),
    item('0.05', 154, y, 18),
    item('10.36', 112, y, 23),
    item('103,578.03', 57, y, 45),
  ];
  const line = reconstructPage(items);
  assert.equal(line.split('\n').length, 1);
  for (const tok of ['404602703004', '10000', '0.05', '10.36', '103,578.03']) {
    assert.ok(new RegExp(`(^|\\s)${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(line), `"${tok}" not a standalone token in: "${line}"`);
  }
});

// ── REGRESSION: a tight item table inside loose prose ────────────────────────
// Krosaki's real quotation (OFR26-0040) sets its item rows 9.5pt apart inside a
// letter whose paragraphs sit 19pt apart. The row tolerance was derived from the
// MEDIAN baseline gap — 19 — and half of that is 9.5, exactly the table's pitch,
// so every pair of item rows collapsed into one line and two distinct products
// became a single item:
//   "V DIA 10MM H=70MM AISI 310 CAPPED ACC DRWG TWS.10(60)-200(140)-45-253MA-C"
// PR row 2 then had nothing to match and printed "Not quoted". The tolerance must
// key off the TIGHTEST row pitch in the document, not the average one.
test('reconstructPage: a dense table inside loose prose keeps one line per row', () => {
  const items: ReturnType<typeof item>[] = [];
  const h = 7.2; // the real glyph height in that quotation

  // Loose prose above the table — 19pt apart, and the bulk of the page's text.
  const prose = [
    'We have the pleasure to submit to you our best possible offer for the supply',
    'of the requested refractory materials for your kiln maintenance programme.',
    'Please find our commercial terms and the itemised pricing set out below.',
    'All prices are quoted in Euro and remain valid for fifteen days from issue.',
  ];
  prose.forEach((p, i) => items.push(item(p, 21, 600 - i * 19, 420, h)));

  // The item table — rows only 9.5pt apart, each split across sub-point baselines
  // exactly as the real PDF emits them (POS number, description, then figures).
  const TABLE = [
    { pos: '1', desc: 'TWS.10(60)-200(140)-45-253MA-C', qty: '10,000', price: '2.42 €' },
    { pos: '2', desc: 'V DIA 10MM H=70MM AISI 310 CAPPED ACC DRWG', qty: '2,000', price: '0.95 €' },
    { pos: '3', desc: 'TWS.10(60)-250(140)-45-253MA-C', qty: '1,500', price: '2.93 €' },
    { pos: '4', desc: 'TWS.10(60)-170(80)-45-253MA-C', qty: '300', price: '2.24 €' },
    { pos: '5', desc: 'TWS.10(60)-180(100)-45-253MA-C', qty: '700', price: '2.33 €' },
  ];
  const tableY = (r: number) => 460 - r * 9.5;
  TABLE.forEach((row, r) => {
    items.push(item(row.pos, 39, tableY(r) + 0.5, 5, h));
    items.push(item(row.desc, 71, tableY(r), 190, h));
    items.push(item(row.qty, 292, tableY(r) - 0.5, 26, h));
    items.push(item(row.price, 436, tableY(r) - 0.5, 24, h));
  });

  const lines = reconstructPage(items).split('\n');

  // Every product sits on its OWN line, with its own quantity and price.
  for (const row of TABLE) {
    const hits = lines.filter((l) => l.includes(row.desc));
    assert.equal(hits.length, 1, `"${row.desc}" appears on exactly one line`);
    assert.ok(hits[0].includes(row.qty), `its own qty ${row.qty}: ${hits[0]}`);
    assert.ok(hits[0].includes(row.price), `its own price ${row.price}: ${hits[0]}`);
  }
  // …and never merged with the neighbouring product.
  const merged = lines.find((l) => l.includes('AISI 310') && l.includes('TWS.10(60)-200(140)'));
  assert.equal(merged, undefined, `rows 1 and 2 must not merge, got: ${merged}`);
});
