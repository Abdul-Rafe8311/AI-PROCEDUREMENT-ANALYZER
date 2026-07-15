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
