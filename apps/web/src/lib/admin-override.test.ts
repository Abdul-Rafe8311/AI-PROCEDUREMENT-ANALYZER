import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationText, endOfLocalDayIso, formatYmd, isStrictlyFutureDate } from './admin-override';

test('confirmationText matches the exact wording', () => {
  assert.equal(
    confirmationText('pro', '2026-11-30'),
    'Sets Pro until 30 Nov 2026, effective immediately. Falls back to Free at expiry. Recorded in the audit log.',
  );
});

test('endOfLocalDayIso is the last millisecond of the local day', () => {
  const iso = endOfLocalDayIso('2026-11-30') as string;
  const d = new Date(iso);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 10, 30, 23, 59, 59]);
  assert.equal(endOfLocalDayIso(''), null);
  assert.equal(endOfLocalDayIso('2026-02-31'), null);
});

test('isStrictlyFutureDate rejects today, past and invalid', () => {
  const now = new Date(2026, 10, 11, 15, 0, 0);
  assert.equal(isStrictlyFutureDate('2026-11-12', now), true);
  assert.equal(isStrictlyFutureDate('2026-11-11', now), false);
  assert.equal(isStrictlyFutureDate('2026-11-10', now), false);
  assert.equal(isStrictlyFutureDate('', now), false);
});

test('formatYmd falls back to the input', () => {
  assert.equal(formatYmd('nope'), 'nope');
});
