// The Excel layout is a pure function of the sheet JSON, so it is asserted cell
// by cell — merges, borders, fills and heights included. The formatting details
// here are not cosmetic: a merged range whose interior cells carry no border
// renders in Excel as a blank gap where the table's grid should be, which is the
// single easiest way for this sheet to look broken to a buyer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenderWorkbook, planRows } from './excel';
import { seedTenderSheet, chemicalsFor, requiredChemicalValue } from './seed';
import { answerKey, mergeAiAnswers, type TenderAnswers, type TenderSheet } from './types';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from '../extraction-server';

// The real PR 12602087 castable rows — the sheet this feature reproduces.
const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12602087',
    items: [
      { itemCode: '404601701001', description: 'Castable, High Alumina, ≥95% Al2O3.', quantity: 10, unit: 'Ton' },
      { itemCode: '404601701003', description: 'Castable, Medium Alumina, ≥60% Al2O3.', quantity: 50000, unit: 'Kilogram' },
      { itemCode: '404601701007', description: 'Silicon Carbide Castable, 60% Al2O3', quantity: 35, unit: 'Ton' },
      { itemCode: '404601705010', description: 'Castable Zirconium Anti Coating, Alkali Resistance', quantity: 10, unit: 'Ton' },
    ],
  },
  'pr.pdf',
)!;

const sup = (supplierName: string): LlmSupplier => ({
  supplierName, reference: null, prNumber: '12602087', currency: 'USD', totalAmount: 1000, vatAmount: null,
  totalWithoutVat: 1000, totalsByCurrency: null, deliveryTime: '30 days', deliveryTerms: 'CIF', countryOfOrigin: 'India',
  supplierCountry: null, paymentTerms: null, warranty: '12 months', validUntil: null,
  lineItems: [{ name: 'X', quantity: 10, unitPrice: 100, totalPrice: 1000, category: 'product', uom: 'Ton', availableInDays: null }],
});
const quotations = quotationsFromLlmSuppliers([sup('Legion Exim'), sup('Siam Refractory'), sup('RHI Magnesita')], 'q.pdf', { currency: 'USD', confidence: 0.9 });

const sheet = (): TenderSheet => seedTenderSheet('t1', pr, quotations);

test('SEED: the chemical list differs per item — ZrO2/SiC only where the PR asks', () => {
  assert.deepEqual(chemicalsFor('Castable, High Alumina, ≥95% Al2O3.'), ['Al2O3', 'SiO2', 'Fe2O3', 'CaO']);
  assert.ok(chemicalsFor('Silicon Carbide Castable').includes('SiC'), 'SiC appears for a SiC castable');
  assert.ok(!chemicalsFor('Silicon Carbide Castable').includes('ZrO2'), 'and ZrO2 does not');
  const zr = chemicalsFor('Castable Zirconium Anti Coating, Alkali Resistance');
  assert.ok(zr.includes('ZrO2') && zr.includes('Na2O'), `zirconia + alkali: ${zr.join(',')}`);
});

test('SEED: a required value is read from the PR wording, never invented', () => {
  assert.equal(requiredChemicalValue('Castable, High Alumina, ≥95% Al2O3.', 'Al2O3'), '≥95%');
  assert.equal(requiredChemicalValue('Castable, High Alumina, ≥95% Al2O3.', 'SiO2'), null, 'unmentioned → null → prints N/A');
});

test('SEED: every PR item and every invited supplier gets a column, quoted or not', () => {
  const t = sheet().template;
  assert.equal(t.suppliers.length, 3);
  assert.equal(t.sections.find((s) => s.id === 'specs')!.items!.length, 4);
  // 4 technical sections + 7 commercial criteria.
  assert.equal(t.sections.filter((s) => s.type === 'single_row').length, 7);
  assert.deepEqual(t.sections.map((s) => s.slNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('PLAN: per_item_params emits one row PER PARAMETER and merges col C across them', () => {
  const { rows, sections } = planRows(sheet());
  const physical = sections.find((s) => s.section.id === 'physical')!;
  // 4 items x 8 physical parameters.
  assert.equal(physical.bottom - physical.top + 1, 32);
  assert.equal(physical.itemSpans.length, 4);
  for (const span of physical.itemSpans) {
    assert.equal(span.bottom - span.top + 1, 8, 'each item spans its 8 parameter rows');
  }
  // The label column carries the PARAMETER name on such a row.
  assert.equal(rows.find((r) => r.row === physical.top)!.label, 'Maximum grain size');
});

test('PLAN: chemical rows are one per item, newline-separated "Name → value" pairs', () => {
  const { rows, sections } = planRows(sheet());
  const chem = sections.find((s) => s.section.id === 'chemical')!;
  assert.equal(chem.bottom - chem.top + 1, 4, 'one row per item');
  const first = rows.find((r) => r.row === chem.top)!;
  assert.ok(first.label.startsWith('Al2O3 → ≥95%'), first.label);
  assert.ok(first.label.includes('SiO2 → N/A'), 'an unstated chemical prints N/A');
  assert.equal(first.label.split('\n').length, 4);
});

test('EXCEL: every cell of every merged range carries a border (no blank grid gaps)', async () => {
  const wb = await buildTenderWorkbook(sheet());
  const ws = wb.worksheets[0];
  const merges = Object.values((ws as unknown as { _merges: Record<string, { top: number; left: number; bottom: number; right: number }> })._merges ?? {});
  assert.ok(merges.length > 5, `the sheet has merged ranges, got ${merges.length}`);
  for (const m of merges) {
    for (let r = m.top; r <= m.bottom; r++) {
      for (let c = m.left; c <= m.right; c++) {
        const b = ws.getCell(r, c).border;
        assert.ok(b?.top && b?.left && b?.bottom && b?.right, `merged cell r${r}c${c} keeps all four borders`);
      }
    }
  }
});

test('EXCEL: header fills, frozen panes and column widths match the manual sheet', async () => {
  const wb = await buildTenderWorkbook(sheet());
  const ws = wb.worksheets[0];
  const fill = (c: number) => (ws.getCell(1, c).fill as { fgColor?: { argb?: string } })?.fgColor?.argb;
  for (const c of [1, 2, 3, 4]) assert.equal(fill(c), 'FFFFFF00', `col ${c} header is yellow`);
  for (const c of [5, 6, 7]) assert.equal(fill(c), 'FF92D050', `supplier col ${c} header is green`);
  assert.equal(ws.getCell(1, 5).value, 'Legion Exim');
  assert.deepEqual(ws.views[0], { state: 'frozen', xSplit: 4, ySplit: 1 });
  assert.equal(ws.getColumn(4).width, 38);
  assert.equal(ws.getColumn(5).width, 26);
  assert.equal(ws.getCell(1, 1).font?.name, 'Arial');
});

test('EXCEL: the rotated criteria title spans its whole section', async () => {
  const wb = await buildTenderWorkbook(sheet());
  const ws = wb.worksheets[0];
  const { sections } = planRows(sheet());
  const chem = sections.find((s) => s.section.id === 'chemical')!;
  const b = ws.getCell(chem.top, 2);
  assert.equal(b.value, 'Chemical Analysis');
  assert.equal(b.alignment?.textRotation, 90);
  assert.equal(ws.getCell(chem.top, 1).value, 2, 'column A carries the section number');
});

test('EXCEL: a commercial criterion merges B:D and carries a dark-red rule', async () => {
  const wb = await buildTenderWorkbook(sheet());
  const ws = wb.worksheets[0];
  const { sections } = planRows(sheet());
  const delivery = sections.find((s) => s.section.title === 'Delivery Time')!;
  assert.equal(ws.getCell(delivery.top, 2).value, 'Delivery Time');
  const border = ws.getCell(delivery.top, 1).border;
  assert.equal(border?.top?.style, 'medium');
  assert.equal(border?.top?.color?.argb, 'FF8B0000');
});

test('EXCEL: row height grows with the tallest cell’s line count', async () => {
  const s = sheet();
  const chem = s.template.sections.find((x) => x.id === 'chemical')!;
  const key = answerKey(chem.id, 1, null, s.template.suppliers[0].supplierId);
  s.answers[key] = { value: 'Al2O3 → 96%\nSiO2 → 1%\nFe2O3 → 0.5%\nCaO → 2%\nextra → 1', source: 'ai' };
  const wb = await buildTenderWorkbook(s);
  const ws = wb.worksheets[0];
  const { sections } = planRows(s);
  const top = sections.find((x) => x.section.id === 'chemical')!.top;
  assert.ok((ws.getRow(top).height ?? 0) >= 5 * 13, `5 lines of content sized the row: ${ws.getRow(top).height}`);
});

test('EXCEL: supplier answers land in their own column', async () => {
  const s = sheet();
  const specs = s.template.sections.find((x) => x.id === 'specs')!;
  s.answers[answerKey(specs.id, 2, null, s.template.suppliers[1].supplierId)] = { value: 'C60A — Low Cement Castable', source: 'ai' };
  const wb = await buildTenderWorkbook(s);
  const ws = wb.worksheets[0];
  const { sections } = planRows(s);
  const row = sections.find((x) => x.section.id === 'specs')!.top + 1; // item 2
  assert.equal(ws.getCell(row, 6).value, 'C60A — Low Cement Castable', 'second supplier = column F');
  assert.equal(ws.getCell(row, 5).value, '', 'first supplier column stays empty');
});

test('ANSWERS: re-running the AI never overwrites a reviewer’s edit', () => {
  const existing: TenderAnswers = {
    a: { value: 'human wrote this', source: 'user' },
    b: { value: 'old ai', source: 'ai' },
  };
  const merged = mergeAiAnswers(existing, {
    a: { value: 'new ai', source: 'ai' },
    b: { value: 'new ai', source: 'ai' },
  });
  assert.equal(merged.a.value, 'human wrote this', 'the human edit stands');
  assert.equal(merged.a.source, 'user');
  assert.equal(merged.a.aiValue, 'new ai', 'the AI suggestion is kept for "reset to AI"');
  assert.equal(merged.b.value, 'new ai', 'an untouched AI cell refreshes');
});

test('EXCEL: the workbook writes real .xlsx bytes', async () => {
  const wb = await buildTenderWorkbook(sheet());
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  assert.ok(buf.length > 5000, `non-trivial workbook, got ${buf.length} bytes`);
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'a zip container, i.e. a real xlsx');
});
