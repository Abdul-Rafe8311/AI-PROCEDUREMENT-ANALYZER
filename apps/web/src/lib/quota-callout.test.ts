import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuotaBlock, quotaCalloutMessage, withNoUsageNote } from './quota-callout';
import { formatQuotaDate } from './entitlements/quota-window';

test('date is formatted like 1 Dec 2026 in Riyadh time', () => {
  assert.equal(formatQuotaDate('2026-11-30T21:00:00Z'), '1 Dec 2026');
  assert.equal(formatQuotaDate('2026-11-30T20:59:59Z'), '30 Nov 2026');
  assert.equal(formatQuotaDate('2026-09-09T00:00:00Z'), '9 Sep 2026');
});

test('all used message', () => {
  assert.equal(
    quotaCalloutMessage({ plan: 'free', quota: 14, remaining: 0, resetAt: '2026-11-30T21:00:00Z', selected: 1 }),
    "You've used all 14 PDFs on your Free plan. Resets on 1 Dec 2026. See plans.",
  );
});

test('batch over remaining message', () => {
  assert.equal(
    quotaCalloutMessage({ plan: 'free', quota: 14, remaining: 1, resetAt: '2026-11-30T21:00:00Z', selected: 5 }),
    'You selected 5 PDFs but have 1 left. Remove 4 or see plans.',
  );
});

test('parseQuotaBlock accepts only a 429 QUOTA_EXCEEDED body', () => {
  const body = { code: 'QUOTA_EXCEEDED', plan: 'free', quota: 14, remaining: 0, resetAt: 'x' };
  assert.deepEqual(parseQuotaBlock(429, body, 3), { plan: 'free', quota: 14, remaining: 0, resetAt: 'x', selected: 3 });
  assert.equal(parseQuotaBlock(500, body, 3), null);
  assert.equal(parseQuotaBlock(429, { code: 'OTHER' }, 3), null);
  assert.equal(parseQuotaBlock(429, null, 3), null);
});

test('failure note is added for extraction failures only', () => {
  assert.match(withNoUsageNote(422, 'Could not read it.'), /Could not read it\.\n\nThis didn't use any of your PDFs\.$/);
  assert.equal(withNoUsageNote(401, 'Sign in required.'), 'Sign in required.');
});
