// The export-identity check. A Technical Approval Form gets signed, so a workbook
// built from a different analysis than the one on screen is a serious and silent
// failure — the file looks well-formed either way.
//
// Fixture data only. No network, no LLM, no API key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisFingerprint } from './analysis-fingerprint';
import { buildFreshAnalysis } from '../../scripts/ta-form-fixture';
import type { AnalysisResult } from './workspace-types';

const analysis = buildFreshAnalysis();

test('IDENTITY: the same analysis fingerprints the same, every time', () => {
  assert.equal(analysisFingerprint(analysis), analysisFingerprint(buildFreshAnalysis()));
});

test('IDENTITY: it names the requisition, so two PRs can never collide', () => {
  assert.match(analysisFingerprint(analysis), /^12601612::/);
});

test('MISMATCH: a different supplier set fingerprints differently', () => {
  const fewer: AnalysisResult = { ...analysis, quotations: analysis.quotations.slice(0, 3) };
  assert.notEqual(analysisFingerprint(fewer), analysisFingerprint(analysis));
});

test('MISMATCH: a different requisition fingerprints differently', () => {
  const other: AnalysisResult = {
    ...analysis,
    purchaseRequisition: { ...analysis.purchaseRequisition!, requestNo: '12602262' },
  };
  assert.notEqual(analysisFingerprint(other), analysisFingerprint(analysis));
});

test('STABLE: column ORDER is not identity — the same set fingerprints alike', () => {
  const reordered: AnalysisResult = { ...analysis, quotations: [...analysis.quotations].reverse() };
  assert.equal(analysisFingerprint(reordered), analysisFingerprint(analysis));
});

test('EMPTY: a missing analysis has its own value rather than throwing', () => {
  assert.equal(analysisFingerprint(null), 'none');
  assert.equal(analysisFingerprint({ ...analysis, quotations: [] }), '12601612::empty');
});
