// Seeds a blank Tender Comparative Sheet from a PR and the suppliers invited to
// quote it. The result is a TEMPLATE only — every supplier cell starts empty and
// is filled by the AI pass (extract.ts) or by the reviewer.
//
// The default parameter sets below are the ones Najran's manual castable sheet
// uses. They are only a STARTING POINT: the template is fully editable, and the
// per-item lists genuinely differ (a zirconia castable carries ZrO2, a silicon
// carbide one carries SiC — neither carries the other's).

import type { ExtractedQuotation, PurchaseRequisition } from '../workspace-types';
import type { TemplateItem, TemplateSection, TenderSheet, TenderTemplate } from './types';

/** Chemicals the sheet asks for, chosen from what the PR item actually mentions. */
const BASE_CHEMICALS = ['Al2O3', 'SiO2', 'Fe2O3', 'CaO'];
const CONDITIONAL_CHEMICALS: { name: string; when: RegExp }[] = [
  { name: 'ZrO2', when: /zircon/i },
  { name: 'SiC', when: /silicon\s*carbide|\bsic\b/i },
  { name: 'MgO', when: /magnesi|\bmgo\b/i },
  { name: 'Na2O', when: /alkali|\bna2o\b/i },
];

const PHYSICAL_PARAMS = [
  'Maximum grain size',
  'Refractoriness',
  'Bulk density',
  'Type of Bond',
  'Installation method',
  'Required water',
  'Cold crushing strength @1000C',
  'Modulus of Rupture',
];

const THERMAL_PARAMS = [
  'Max recommended temperature',
  'Permanent linear change after firing at 1500C',
  'Thermal expansion @1000C',
  'Thermal conductivity at 1000C',
];

/** The commercial criteria, each its own single row. */
export const COMMERCIAL_CRITERIA = [
  'Delivery Time',
  'Shelf Life time',
  'Packing',
  'Warranty',
  'Free supply of mixer and vibrator',
  'Supplier Performance (History)',
  'Country of Origin',
];

/** Chemicals relevant to one PR item — the list genuinely varies per item. */
export function chemicalsFor(description: string): string[] {
  const extra = CONDITIONAL_CHEMICALS.filter((c) => c.when.test(description)).map((c) => c.name);
  return [...BASE_CHEMICALS, ...extra];
}

/**
 * Pull a required value out of the PR's own wording where it states one, e.g.
 * "Castable, High Alumina, >=95% Al2O3" -> Al2O3 = ">=95%". Never invents: a
 * chemical the PR does not mention comes back null and prints as "N/A".
 */
export function requiredChemicalValue(description: string, chemical: string): string | null {
  const esc = chemical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "≥95% Al2O3" / "Al2O3 ≥ 95%" / "40-50 % Al2O3"
  const before = new RegExp(`([≥≤><]?\\s*\\d[\\d.\\-–\\s]*%)\\s*(?:of\\s+)?${esc}\\b`, 'i');
  const after = new RegExp(`${esc}\\b\\s*[:=]?\\s*([≥≤><]?\\s*\\d[\\d.\\-–\\s]*%)`, 'i');
  const m = before.exec(description) ?? after.exec(description);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

export function seedTenderTemplate(
  tenderId: string,
  pr: PurchaseRequisition,
  quotations: ExtractedQuotation[],
): TenderTemplate {
  const items: TemplateItem[] = pr.items.map((it, i) => ({
    itemNo: i + 1,
    itemCode: it.itemCode ?? null,
    requiredSpec: it.description || null,
    parameters: [],
  }));

  const withParams = (params: string[]): TemplateItem[] =>
    items.map((it) => ({ ...it, parameters: params.map((name) => ({ name, requiredValue: null })) }));

  const sections: TemplateSection[] = [
    {
      id: 'specs',
      slNo: 1,
      title: 'Specs As Required',
      type: 'product_offer',
      items: items.map((it) => ({ ...it, parameters: [] })),
    },
    {
      id: 'chemical',
      slNo: 2,
      title: 'Chemical Analysis',
      type: 'per_item_pairs',
      items: items.map((it, i) => {
        const desc = pr.items[i]?.description ?? '';
        return {
          ...it,
          parameters: chemicalsFor(desc).map((name) => ({
            name,
            requiredValue: requiredChemicalValue(desc, name),
          })),
        };
      }),
    },
    { id: 'physical', slNo: 3, title: 'Physical Properties', type: 'per_item_params', items: withParams(PHYSICAL_PARAMS) },
    { id: 'thermal', slNo: 4, title: 'Thermal Properties', type: 'per_item_params', items: withParams(THERMAL_PARAMS) },
    ...COMMERCIAL_CRITERIA.map((title, i) => ({
      id: `commercial-${i}`,
      slNo: 5 + i,
      title,
      type: 'single_row' as const,
    })),
  ];

  return {
    tenderId,
    title: `Comparative — PR ${pr.requestNo ?? ''}`.trim(),
    prNumber: pr.requestNo ?? null,
    // An invited supplier that never quoted still gets its (empty) column.
    suppliers: quotations.map((q) => ({
      supplierId: q.id,
      name: q.supplierName || 'Unnamed supplier',
      quoted: q.lineItems.length > 0 || q.totalCost != null,
    })),
    sections,
  };
}

export const seedTenderSheet = (
  tenderId: string,
  pr: PurchaseRequisition,
  quotations: ExtractedQuotation[],
): TenderSheet => ({ template: seedTenderTemplate(tenderId, pr, quotations), answers: {} });
