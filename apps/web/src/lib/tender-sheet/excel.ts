// Renders a TenderSheet to Najran Cement's manual comparative-sheet layout.
//
// A PURE function of the JSON: template + answers in, ExcelJS workbook out. No
// network, no database, no React — so the layout is unit-testable cell by cell,
// which is the only practical way to keep merged ranges, borders and row heights
// honest.
//
// Layout, matching the manual sheet:
//
//   A        B                    C       D                      E, F, G …
//   Sl.No    Criteria (rotated)   Item #  PR description          one per supplier
//
// Technical sections (1-4) merge A and B vertically across all their rows;
// sections 3-4 additionally merge C across each item's parameter rows. Commercial
// rows (5+) merge B:D for the title.

import type {
  TemplateSection,
  TenderAnswers,
  TenderSheet,
  TenderSupplier,
} from './types';
import { answerKey } from './types';

// ── palette (matches the manual workbook) ──
const YELLOW = 'FFFFFF00'; // Sl.No / Criteria / PR description headers
const GREEN = 'FF92D050'; // supplier name headers
const TAN_LIGHT = 'FFFDF2E0';
const TAN_DARK = 'FFF5E0C0';
const DARK_RED = 'FF8B0000'; // section-boundary rule
const BLACK = 'FF000000';

const FONT = 'Arial';
const COL_A_W = 6;
const COL_B_W = 5; // narrow: the title is rotated 90°
const COL_C_W = 9;
const COL_D_W = 38;
const COL_SUPPLIER_W = 26;
const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;

type Border = 'thin' | 'medium';

/** One laid-out row, before it is written. Keeps the renderer declarative. */
interface PlannedRow {
  /** 1-based sheet row */
  row: number;
  /** column D text */
  label: string;
  /** column C text, when this row starts/holds an item number */
  itemNo?: number | null;
  /** per-supplier cell text, indexed like `template.suppliers` */
  cells: string[];
  /** a medium dark-red top border — section boundary or a commercial row */
  ruleAbove: boolean;
  /** background fill */
  fill: string | null;
  /** the row is a commercial criterion: B:D merge carries `label` */
  commercial: boolean;
}

/** Height for a row, from the tallest cell's line count. */
function rowHeight(texts: string[]): number {
  const lines = Math.max(1, ...texts.map((t) => String(t ?? '').split('\n').length));
  return Math.max(18, lines * 13 + 6);
}

/**
 * Borders every cell of a merged range, not just the anchor.
 *
 * This is the one that bites: ExcelJS applies a style to the top-left cell of a
 * merge, and Excel then draws the range's interior with NO grid lines — the
 * merged blocks come out as blank gaps in the table. Every cell in the range has
 * to be styled individually, before or after merging, for the borders to survive.
 */
function borderRange(
  ws: import('exceljs').Worksheet,
  top: number,
  left: number,
  bottom: number,
  right: number,
  opts: { topEdge?: Border; fill?: string | null } = {},
) {
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top: { style: r === top && opts.topEdge ? opts.topEdge : 'thin', color: { argb: r === top && opts.topEdge === 'medium' ? DARK_RED : BLACK } },
        left: { style: 'thin', color: { argb: BLACK } },
        bottom: { style: 'thin', color: { argb: BLACK } },
        right: { style: 'thin', color: { argb: BLACK } },
      };
      if (opts.fill) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
      }
    }
  }
}

/** Plan every row of the sheet. Separated from writing so it can be asserted on. */
export function planRows(sheet: TenderSheet): { rows: PlannedRow[]; sections: { section: TemplateSection; top: number; bottom: number; itemSpans: { itemNo: number; top: number; bottom: number }[] }[] } {
  const { template, answers } = sheet;
  const suppliers = template.suppliers;
  const rows: PlannedRow[] = [];
  const sections: { section: TemplateSection; top: number; bottom: number; itemSpans: { itemNo: number; top: number; bottom: number }[] }[] = [];
  let row = FIRST_DATA_ROW;

  const cellsFor = (sectionId: string, itemNo: number | null, parameter: string | null): string[] =>
    suppliers.map((s: TenderSupplier) => answers[answerKey(sectionId, itemNo, parameter, s.supplierId)]?.value ?? '');

  for (const section of template.sections) {
    const top = row;
    const itemSpans: { itemNo: number; top: number; bottom: number }[] = [];
    let firstOfSection = true;

    if (section.type === 'single_row') {
      rows.push({
        row: row++,
        label: section.title,
        cells: cellsFor(section.id, null, null),
        ruleAbove: true, // every commercial row carries the rule
        fill: null,
        commercial: true,
      });
    } else {
      const items = section.items ?? [];
      items.forEach((item, i) => {
        const fill = i % 2 === 0 ? TAN_LIGHT : TAN_DARK;
        if (section.type === 'per_item_params') {
          // One row PER PARAMETER; column C merges across them.
          const params = item.parameters.length ? item.parameters : [{ name: '—' }];
          const itemTop = row;
          for (const p of params) {
            rows.push({
              row: row++,
              label: p.name,
              itemNo: item.itemNo,
              cells: cellsFor(section.id, item.itemNo, p.name),
              ruleAbove: firstOfSection,
              fill,
              commercial: false,
            });
            firstOfSection = false;
          }
          itemSpans.push({ itemNo: item.itemNo, top: itemTop, bottom: row - 1 });
        } else {
          // product_offer / per_item_pairs — ONE row per item.
          const label =
            section.type === 'per_item_pairs'
              ? item.parameters.map((p) => `${p.name} → ${p.requiredValue ?? 'N/A'}`).join('\n')
              : item.requiredSpec ?? '';
          rows.push({
            row: row++,
            label,
            itemNo: item.itemNo,
            cells: cellsFor(section.id, item.itemNo, null),
            ruleAbove: firstOfSection,
            fill,
            commercial: false,
          });
          itemSpans.push({ itemNo: item.itemNo, top: row - 1, bottom: row - 1 });
          firstOfSection = false;
        }
      });
    }
    if (row > top) sections.push({ section, top, bottom: row - 1, itemSpans });
  }
  return { rows, sections };
}

/**
 * Build the workbook. Pure: same JSON in, same bytes out.
 */
export async function buildTenderWorkbook(sheet: TenderSheet): Promise<import('exceljs').Workbook> {
  // exceljs ships CommonJS, so under an ESM/bundler interop the namespace object
  // has the real module on `.default`. Take whichever actually carries Workbook.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Procurement Copilot';
  const ws = wb.addWorksheet(sheet.template.title.slice(0, 31) || 'Comparative');

  const suppliers = sheet.template.suppliers;
  const lastCol = 4 + suppliers.length;

  ws.columns = [
    { width: COL_A_W },
    { width: COL_B_W },
    { width: COL_C_W },
    { width: COL_D_W },
    ...suppliers.map(() => ({ width: COL_SUPPLIER_W })),
  ];

  // ── header row ──
  const headers = ['Sl.No', 'Criteria', 'Item #', sheet.template.prNumber ? `PR ${sheet.template.prNumber} — Description` : 'PR Description', ...suppliers.map((s) => s.name)];
  headers.forEach((h, i) => {
    const cell = ws.getCell(HEADER_ROW, i + 1);
    cell.value = h;
    cell.font = { name: FONT, bold: true, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < 4 ? YELLOW : GREEN } };
  });
  borderRange(ws, HEADER_ROW, 1, HEADER_ROW, lastCol);
  ws.getRow(HEADER_ROW).height = rowHeight(headers);

  const { rows, sections } = planRows(sheet);

  // ── data rows ──
  for (const r of rows) {
    const line = ws.getRow(r.row);
    if (r.commercial) {
      ws.getCell(r.row, 2).value = r.label;
    } else {
      if (r.itemNo != null) ws.getCell(r.row, 3).value = r.itemNo;
      ws.getCell(r.row, 4).value = r.label;
    }
    r.cells.forEach((v, i) => {
      ws.getCell(r.row, 5 + i).value = v;
    });
    // Style the whole width first, so merged interiors keep their borders.
    borderRange(ws, r.row, 1, r.row, lastCol, { topEdge: r.ruleAbove ? 'medium' : undefined, fill: r.fill });
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r.row, c);
      cell.font = { name: FONT, size: 9, bold: r.commercial && c === 2 };
      cell.alignment = { vertical: 'top', horizontal: c === 3 ? 'center' : 'left', wrapText: true };
    }
    line.height = rowHeight([r.label, ...r.cells]);
  }

  // ── merges ──
  for (const s of sections) {
    if (s.section.type === 'single_row') {
      // B:D carries the commercial criterion's title.
      ws.mergeCells(s.top, 2, s.bottom, 4);
      ws.getCell(s.top, 1).value = s.section.slNo;
      continue;
    }
    // A = section number, B = rotated title, both spanning the whole section.
    ws.mergeCells(s.top, 1, s.bottom, 1);
    ws.mergeCells(s.top, 2, s.bottom, 2);
    const a = ws.getCell(s.top, 1);
    a.value = s.section.slNo;
    a.alignment = { vertical: 'middle', horizontal: 'center' };
    a.font = { name: FONT, bold: true, size: 10 };
    const b = ws.getCell(s.top, 2);
    b.value = s.section.title;
    b.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90, wrapText: true };
    b.font = { name: FONT, bold: true, size: 10 };
    // Column C merges per item, but only where an item spans several rows.
    if (s.section.type === 'per_item_params') {
      for (const span of s.itemSpans) {
        if (span.bottom > span.top) ws.mergeCells(span.top, 3, span.bottom, 3);
        const c = ws.getCell(span.top, 3);
        c.value = span.itemNo;
        c.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }
  }

  // Freeze below the header, to the right of column D.
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: HEADER_ROW }];
  return wb;
}

/** The workbook as bytes, ready to stream as a download. */
export async function tenderWorkbookBuffer(sheet: TenderSheet): Promise<Buffer> {
  const wb = await buildTenderWorkbook(sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
