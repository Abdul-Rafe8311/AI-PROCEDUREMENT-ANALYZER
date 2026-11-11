import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNotice } from './plan-notice';

const NOW = new Date('2026-11-11T00:00:00Z');

test('paid plan with 3 days or fewer left shows the renew notice', () => {
  const n = planNotice({ plan: 'pro', expiresAt: '2026-11-14T00:00:00Z', lastExpired: null }, NOW, null);
  assert.equal(n?.kind, 'ending');
  assert.equal(n?.text, 'Your Pro plan ends on 14 Nov 2026. Renew to add 30 more days.');
});

test('paid plan with more than 3 days left shows nothing', () => {
  assert.equal(planNotice({ plan: 'pro', expiresAt: '2026-11-14T00:00:01Z', lastExpired: null }, NOW, null), null);
});

test('expired plan is announced once, then never again for the same period', () => {
  const e = { plan: 'free', expiresAt: null, lastExpired: { plan: 'plus', endedAt: '2026-11-05T00:00:00.000Z' } };
  const first = planNotice(e, NOW, null);
  assert.equal(first?.text, "Your Plus plan ended on 5 Nov 2026. You're on Free. Your data is still here.");
  assert.equal(planNotice(e, NOW, first!.key), null);
});

test('no notice for a plain Free user or a paid user whose earlier plan ended', () => {
  assert.equal(planNotice({ plan: 'free', expiresAt: null, lastExpired: null }, NOW, null), null);
  assert.equal(
    planNotice({ plan: 'pro', expiresAt: '2027-01-01T00:00:00Z', lastExpired: { plan: 'plus', endedAt: '2026-10-01T00:00:00.000Z' } }, NOW, null),
    null,
  );
});
