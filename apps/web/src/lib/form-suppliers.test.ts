// Hiding supplier columns from the Technical Approval Form, and numbering what
// is left.
//
// Hiding is a DISPLAY FILTER: the supplier stays in the analysis. But it must be a
// real filter on the printed form — a hidden column that still won the "lowest
// price" highlight would be worse than not hiding it at all, because the mark
// would point at a column nobody can see.
//
// Fixture data through the real renderers. No network, no LLM, no API key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { extractText, getDocumentProxy } from 'unpdf';
import { formSuppliers } from './form-suppliers';
import { buildComparisonModel } from './pr-comparison';
import { taFormWorkbookBuffer } from './ta-form-excel';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';

// tsconfig uses jsx:"preserve", so the renderer's .tsx module is emitted with the
// CLASSIC runtime. Next supplies React automatically; a test must not.
(globalThis as unknown as { React: typeof React }).React = React;

const analysis = buildFreshAnalysis();
const ids = analysis.quotations.map((q) => q.id);
const names = analysis.quotations.map((q) => q.supplierName);

// ── 1. the filter ───────────────────────────────────────────────────────────

test('HIDE: a hidden supplier is dropped from the printed set', () => {
  const { analysis: shown } = formSuppliers(analysis, { hiddenSuppliers: [ids[1]] });
  assert.equal(shown.quotations.length, analysis.quotations.length - 1);
  assert.ok(!shown.quotations.some((q) => q.id === ids[1]));
});

test('HIDE: the analysis itself is never mutated — this is a display filter', () => {
  formSuppliers(analysis, { hiddenSuppliers: [ids[1]] });
  assert.equal(analysis.quotations.length, 5, 'the source analysis still has every supplier');
});

test('HIDE: the PR match is filtered in step, so nothing disagrees', () => {
  const { analysis: shown } = formSuppliers(analysis, { hiddenSuppliers: [ids[0], ids[1]] });
  const matched = (shown.prMatch?.bySupplier ?? []).map((s) => s.quotationId);
  assert.deepEqual(matched.sort(), shown.quotations.map((q) => q.id).sort());
});

test('HIDE: hiding nothing returns the very same analysis object', () => {
  assert.equal(formSuppliers(analysis, {}).analysis, analysis);
});

// ── 2. numbering ────────────────────────────────────────────────────────────

test('NUMBERING: renumber closes the gap (the default)', () => {
  const { displayNo } = formSuppliers(analysis, { hiddenSuppliers: [ids[1]] });
  assert.deepEqual(
    analysis.quotations.filter((q) => q.id !== ids[1]).map((q) => displayNo[q.id]),
    [1, 2, 3, 4],
  );
});

test('NUMBERING: original keeps the pre-hide numbers, gap and all', () => {
  const { displayNo } = formSuppliers(analysis, {
    hiddenSuppliers: [ids[1]],
    supplierNumbering: 'original',
  });
  assert.deepEqual(
    analysis.quotations.filter((q) => q.id !== ids[1]).map((q) => displayNo[q.id]),
    [1, 3, 4, 5],
  );
});

// ── 3. the backstop ─────────────────────────────────────────────────────────

test('ALL HIDDEN: the selection is ignored — a form with no prices is not a form', () => {
  const { analysis: shown, allHidden } = formSuppliers(analysis, { hiddenSuppliers: ids });
  assert.equal(allHidden, true, 'reported, so a caller can disable the download');
  assert.equal(shown.quotations.length, 5, 'rather than emitting an empty form');
});

// ── 4. scoring: a hidden column stops competing ─────────────────────────────

test('SCORING: the lowest-price highlight ignores hidden columns', () => {
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, {
    prOnly: true,
    fx: FX,
  });
  const row = model.rows.filter((r) => r.kind === 'pr')[0];
  const cheapestIdx = row.cells.findIndex((c) => c?.unitPriceUsd != null && c.unitPriceUsd === row.lowestUsd);
  assert.ok(cheapestIdx >= 0, 'the fixture has a cheapest column to begin with');

  // Hide exactly that column; the highlight must move to someone still on the page.
  const { analysis: shown } = formSuppliers(analysis, { hiddenSuppliers: [ids[cheapestIdx]] });
  const after = buildComparisonModel(shown.quotations, shown.purchaseRequisition, shown.prMatch, {
    prOnly: true,
    fx: FX,
  });
  const rowAfter = after.rows.filter((r) => r.kind === 'pr')[0];
  assert.notEqual(rowAfter.lowestUsd, row.lowestUsd, 'the hidden column no longer sets the low');
  assert.ok(
    rowAfter.cells.some((c) => c?.unitPriceUsd === rowAfter.lowestUsd),
    'the new low belongs to a column that is actually printed',
  );
});

// ── 5. both renderers honour it ─────────────────────────────────────────────

test('PDF: a hidden supplier is not printed, and numbering follows the choice', async () => {
  const { generateApprovalFormPdf } = await import('./approval-form');
  const render = async (opts: Record<string, unknown>) => {
    const blob = await generateApprovalFormPdf(analysis, { fx: FX, ...opts });
    const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
    const { text } = await extractText(doc, { mergePages: true });
    return (text as string).replace(/\s+/g, ' ');
  };

  const full = await render({});
  assert.ok(full.includes(names[1]), 'the supplier is on the unfiltered form');

  const hidden = await render({ hiddenSuppliers: [ids[1]] });
  assert.ok(!hidden.includes(names[1]), 'and gone once hidden');
  assert.ok(hidden.includes(names[0]), 'while the others remain');

  const kept = await render({ hiddenSuppliers: [ids[1]], supplierNumbering: 'original' });
  assert.ok(kept.includes('SUPPLIER #3'), 'original numbering keeps #3');
  assert.ok(!kept.includes('SUPPLIER #2'), 'and leaves #2 vacant — it was the hidden one');
});

test('EXCEL: the same hiding and numbering, so the two downloads agree', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const flatten = async (opts: Record<string, unknown>) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await taFormWorkbookBuffer(analysis, { fx: FX, ...opts })) as unknown as ArrayBuffer);
    let out = '';
    wb.worksheets.forEach((ws) => ws.eachRow((r) => r.eachCell((c) => { out += ` ${c.text ?? ''}`; })));
    return out.replace(/\s+/g, ' ');
  };

  const hidden = await flatten({ hiddenSuppliers: [ids[1]] });
  assert.ok(!hidden.includes(names[1]), 'the hidden supplier is absent from the workbook');
  assert.ok(hidden.includes(names[0]), 'the others are present');
  assert.ok(hidden.includes('SUPPLIER #2'), 'renumbered by default — no gap');

  const kept = await flatten({ hiddenSuppliers: [ids[1]], supplierNumbering: 'original' });
  assert.ok(kept.includes('SUPPLIER #3') && !kept.includes('SUPPLIER #2'), 'original numbering keeps the gap');
});
