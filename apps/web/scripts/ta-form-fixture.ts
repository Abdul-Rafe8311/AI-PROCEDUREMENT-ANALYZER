/*
 * The REAL PR 12601612 data set (5 suppliers, their real quoted part codes),
 * rebuilt from scratch on every call through the same pipeline the app uses
 * (extraction mapping -> PR matching -> assembleAnalysis -> applyFxRates).
 * Nothing here is cached or restored.
 *
 * Shared by scripts/ta-form-preview.ts and the layout probes so every tool
 * inspects exactly the same analysis.
 */

import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from '../src/lib/extraction-server';
import { applyFxRates, assembleAnalysis } from '../src/lib/analysis-engine';
import type { FxRates } from '../src/lib/fx-rates';
import type { AnalysisResult } from '../src/lib/workspace-types';

// Fixed rate so the run is deterministic (the app uses the live feed).
export const FX: FxRates = { base: 'USD', rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 }, asOf: '2026-07-25T00:00:00.000Z', live: true, source: 'preview' };

// ── The company requisition, as read off PR 12601612 ──
const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for Kiln department',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 10000, unit: 'EA' },
      { itemCode: '404602701007', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', quantity: 2000, unit: 'EA' },
      { itemCode: '404602703033', description: 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 1500, unit: 'EA' },
      { itemCode: '404602703042', description: 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 300, unit: 'EA' },
      { itemCode: '404602703043', description: 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 700, unit: 'EA' },
    ],
  },
  'requisition-12601612.pdf',
)!;

const QTY = [10000, 2000, 1500, 300, 700];
const items = (names: string[], prices: number[]) =>
  names.map((name, i) => ({ name, quantity: QTY[i], unitPrice: prices[i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null }));
const freight = (name: string, amount: number) =>
  ({ name, quantity: 1, unitPrice: null, totalPrice: amount, category: 'freight' as const, uom: null, availableInDays: null });
const base = (o: Partial<LlmSupplier>): LlmSupplier => ({
  supplierName: '', reference: null, prNumber: '12601612', currency: 'SAR', totalAmount: null, vatAmount: null,
  totalWithoutVat: null, totalsByCurrency: null, deliveryTime: null, deliveryTerms: null, countryOfOrigin: null,
  supplierCountry: null, paymentTerms: null, warranty: null, validUntil: null, lineItems: [], ...o,
});

const krosaki = base({
  supplierName: 'KROSAKI', reference: 'OFR26-0040', currency: 'EUR', countryOfOrigin: 'Country of Origin: France',
  deliveryTime: '4 weeks after official order', deliveryTerms: 'CIF JEDDAH', paymentTerms: 'CAD', warranty: '12 months',
  lineItems: [
    ...items(
      ['TWS.10(60)-200(140)-45-253MA-C', 'V DIA 10MM H=70MM AISI 310 CAPPED', 'TWS.10(60)-250(140)-45-253MA-C', 'TWS.10(60)-170(80)-45-253MA-C', 'TWS.10(60)-180(100)-45-253MA-C'],
      [2.42, 0.95, 2.93, 2.24, 2.33],
    ),
    freight('TRANSPORT PRICE CIF JEDDAH', 3590),
  ],
});
const alnajim = base({
  supplierName: 'AL NAJIM', reference: 'WS/QM/06/26-117', supplierCountry: 'Saudi Arabia',
  deliveryTime: '08 - Weeks', deliveryTerms: 'by Naqel', paymentTerms: '100% Advance',
  lineItems: pr.items.map((it, i) => ({ name: it.description, quantity: QTY[i], unitPrice: [15.5, 6, 18.5, 14.25, 15][i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null })),
});
const alfran = base({
  supplierName: 'AlFRAN', reference: 'Q-ASA-NCC-260603', supplierCountry: 'KSA',
  deliveryTime: '65 days after order confirmation', deliveryTerms: 'DDP', paymentTerms: '30 DAYS CREDIT', warranty: '24 months',
  lineItems: [
    ...items(
      ['Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 MA. With Plastic Caps.', 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 MA. With Plastic Caps.'],
      [10.36, 4.67, 12.43, 9.12, 9.53],
    ),
    freight('Transportation', 7900),
  ],
});
const supplyWave = base({
  supplierName: 'Supply Wave', reference: 'SW-2606082547', supplierCountry: 'Saudi Arabia',
  deliveryTime: '88 Days', deliveryTerms: 'EX WORKS', paymentTerms: '30 Days',
  lineItems: items(
    ['Anchor Corrugated Type: TWS.10(60)-200(140)-40-310. Material GRADE - SS 310', 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', 'Anchor Corrugated Type: TWS.10(60)-250(140)-40-310. Material GRADE - SS 310', 'Anchor Corrugated Type: TWS.10(60)-170(80)-40-310. Material GRADE - SS 310', 'Anchor Corrugated Type: TWS.10(60)-180(100)-40-310. Material GRADE - SS 310'],
    [10.4, 3, 12.1, 9, 9],
  ),
});
const refratechnik = base({
  supplierName: 'Refratechnik', reference: '9100147169', currency: 'EUR', countryOfOrigin: 'F.R. OF GERMANY',
  deliveryTime: '4-5 weeks', deliveryTerms: 'FOB', paymentTerms: 'Cash against documents',
  lineItems: [
    ...items(['REVA-W.10-200', 'REVA.10-070', 'REVA-W.10-250', 'REVA-W.10-170', 'REVA-W.10-180'], [3.07, 3.21, 3.7, 4.12, 2.8]),
    freight('Freight and FOB charges', 870),
  ],
});


/** Rebuild the analysis from scratch (never cached, never restored). */
export function buildFreshAnalysis(): AnalysisResult {
  const quotations = quotationsFromLlmSuppliers(
    [krosaki, alnajim, alfran, supplyWave, refratechnik],
    'quotations-12601612.pdf',
    { currency: 'SAR', confidence: 0.9 },
  );
  return applyFxRates(assembleAnalysis(quotations, false, pr), FX);
}
