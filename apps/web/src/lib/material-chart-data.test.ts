import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialData, shortItemLabel } from './material-chart-data';
import { matchQuotationsToPr } from './item-matching';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import type { FxRates } from './fx-rates';

const FX: FxRates = { base: 'USD', rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 }, asOf: 'x', live: true, source: 'x' };

const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for production department.',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 10000, unit: 'EA' },
      { itemCode: '404602701007', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', quantity: 2000, unit: 'EA' },
      { itemCode: '404602703033', description: 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 1500, unit: 'EA' },
      { itemCode: '404602703042', description: 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 300, unit: 'EA' },
      { itemCode: '404602703043', description: 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 700, unit: 'EA' },
    ],
  },
  'pr.pdf',
)!;

const QTY = [10000, 2000, 1500, 300, 700];
const P = (names: string[], prices: number[], cur: string) =>
  names.map((name, i) => ({ name, quantity: QTY[i], unitPrice: prices[i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null }));
const frt = (n: string, a: number) => ({ name: n, quantity: 1, unitPrice: null, totalPrice: a, category: 'freight' as const, uom: null, availableInDays: null });
const b = (o: Partial<LlmSupplier>): LlmSupplier => ({ supplierName: '', reference: null, prNumber: '12601612', currency: 'SAR', totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null, deliveryTime: null, deliveryTerms: null, countryOfOrigin: null, supplierCountry: null, paymentTerms: null, warranty: null, validUntil: null, lineItems: [], ...o });

// Krosaki quotes in EUR + a freight line; the SAR suppliers quote per-unit SAR.
const krosaki = b({ supplierName: 'KROSAKI', currency: 'EUR', lineItems: [...P(['TWS.10(60)-200(140)-45-253MA-C', 'V DIA 10MM H=70MM AISI 310', 'TWS.10(60)-250(140)-45-253MA-C', 'TWS.10(60)-170(80)-45-253MA-C', 'TWS.10(60)-180(100)-45-253MA-C'], [2.42, 0.95, 2.93, 2.24, 2.33], 'EUR'), frt('TRANSPORT CIF JEDDAH', 3590)] });
const alnajim = b({ supplierName: 'AL NAJIM', supplierCountry: 'Saudi Arabia', lineItems: pr.items.map((it, i) => ({ name: it.description, quantity: QTY[i], unitPrice: [15.5, 6, 18.5, 14.25, 15][i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null })) });
const alfran = b({ supplierName: 'AlFRAN', supplierCountry: 'KSA', lineItems: [...P(['Anchor Corrugated TWS.10(60)-200(140)-40-253 253 MA', 'SS 310 ANCHOR V 10 X 70 KL-42', 'Anchor Corrugated TWS.10(60)-250(140)-40-253 253 MA', 'Anchor Corrugated TWS.10(60)-170(80)-40-253 253 MA', 'Anchor Corrugated TWS.10(60)-180(100)-40-253 253 MA'], [10.36, 4.67, 12.43, 9.12, 9.53], 'SAR'), frt('Transportation', 7900)] });
const sw = b({ supplierName: 'Supply Wave', supplierCountry: 'Saudi Arabia', lineItems: P(['Anchor Corrugated TWS.10(60)-200(140)-40-310 SS 310', 'ANCHOR V 10 X 70 KL-42 SS 310', 'Anchor Corrugated TWS.10(60)-250(140)-40-310 SS310', 'Anchor Corrugated TWS.10(60)-170(80)-40-310 SS310', 'Anchor Corrugated TWS.10(60)-180(100)-40-310 SS310'], [10.4, 3, 12.1, 9, 9], 'SAR') });
const refra = b({ supplierName: 'Refratechnik', currency: 'EUR', lineItems: [
  { name: 'REVA-W.10-200', quantity: 10000, unitPrice: 3.07, totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null },
  { name: 'REVA.10-070', quantity: 2000, unitPrice: 3.21, totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null },
  { name: 'REVA-W.10-250', quantity: 1500, unitPrice: 3.70, totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null },
  { name: 'REVA-W.10-170', quantity: 300, unitPrice: 4.12, totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null },
  { name: 'REVA-W.10-180', quantity: 700, unitPrice: 2.80, totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null },
  frt('Freight and FOB', 870),
] });

const quotations = quotationsFromLlmSuppliers([krosaki, alnajim, alfran, sw, refra], 'q.pdf', { currency: 'SAR', confidence: 0.9 });
const analysis = applyFxRates(assembleAnalysis(quotations, false, pr), FX);
const prMatch = matchQuotationsToPr(analysis.quotations, pr);

test('shortItemLabel: PR anchor rows → short readable labels', () => {
  assert.equal(shortItemLabel(pr.items[0].description, pr.items[0].itemCode), '200(140)');
  assert.equal(shortItemLabel(pr.items[1].description, pr.items[1].itemCode), 'SS 310 / KL-42');
  assert.equal(shortItemLabel(pr.items[2].description, pr.items[2].itemCode), '250(140)');
  assert.equal(shortItemLabel(pr.items[3].description, pr.items[3].itemCode), '170(80)');
  assert.equal(shortItemLabel(pr.items[4].description, pr.items[4].itemCode), '180(100)');
});

test('MATERIAL CHART: 5 PR-item groups, 5 supplier bars each, freight excluded', () => {
  const { materialData, materialSuppliers } = buildMaterialData(analysis.quotations, prMatch, pr, FX);

  // 5 groups (one per PR item), in PR order, with the short labels.
  assert.deepEqual(materialData.map((r) => r.item), ['200(140)', 'SS 310 / KL-42', '250(140)', '170(80)', '180(100)']);
  assert.deepEqual(materialSuppliers, ['KROSAKI', 'AL NAJIM', 'AlFRAN', 'Supply Wave', 'Refratechnik']);

  // No freight/transport anywhere: no group is labelled from a charge line, and no
  // cell equals a freight lump sum's USD (7900 SAR ≈ $2107).
  for (const row of materialData) {
    assert.ok(!/transport|freight/i.test(row.item), `no freight group: ${row.item}`);
    for (const s of materialSuppliers) {
      const v = row[s];
      if (typeof v === 'number') assert.ok(v < 6, `unit price stays in range, got ${v} for ${s}/${row.item}`);
    }
  }

  // Acceptance values for item 1 (200/140), USD unit price at the live rate, 2dp.
  const item1 = materialData[0];
  assert.equal(item1['AlFRAN'], 2.76); // SAR 10.36 / 3.7501
  assert.equal(item1['AL NAJIM'], 4.13); // SAR 15.50
  assert.equal(item1['Supply Wave'], 2.77); // SAR 10.40
  assert.equal(item1['KROSAKI'], 2.76); // EUR 2.42
  assert.equal(item1['Refratechnik'], 3.51); // EUR 3.07 / 0.8758 = 3.505 → 3.51 (≈ 3.50)

  // Tooltip metadata carries the supplier's OWN description, qty, and SAR + USD.
  const alfranMeta = item1._meta['AlFRAN'];
  assert.equal(alfranMeta.qty, 10000);
  assert.equal(alfranMeta.usd, 2.76);
  assert.equal(alfranMeta.sar, 10.36); // native SAR unit price
  assert.match(alfranMeta.desc, /253 MA/);
});
