import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDelivery } from './analysis-engine';

test('BUG 3: "08 - Weeks" extracts as 56 days (8 weeks), not 8', () => {
  assert.equal(normalizeDelivery('08 - Weeks'), 56);
});

test('BUG 3: units are honored, never defaulted to days', () => {
  assert.equal(normalizeDelivery('88 Days'), 88);
  assert.equal(normalizeDelivery('8 days'), 8);
  assert.equal(normalizeDelivery('2 weeks'), 14);
  assert.equal(normalizeDelivery('3 Months'), 90);
  assert.equal(normalizeDelivery('1 year'), 365);
  assert.equal(normalizeDelivery('8wks'), 56); // no space
  assert.equal(normalizeDelivery('6 mo'), 180);
  assert.equal(normalizeDelivery('12months'), 360); // no space
});

test('BUG 3: ranges take the number nearest the unit (upper bound)', () => {
  assert.equal(normalizeDelivery('6-8 weeks'), 56);
  assert.equal(normalizeDelivery('2 to 3 months'), 90);
});

test('a bare number with no unit stays days; keywords still work', () => {
  assert.equal(normalizeDelivery('60'), 60);
  assert.equal(normalizeDelivery('10 working days'), 10);
  assert.equal(normalizeDelivery('ASAP'), 1);
  assert.equal(normalizeDelivery('in stock'), 1);
});

test('empty / null delivery', () => {
  assert.equal(normalizeDelivery(null), null);
  assert.equal(normalizeDelivery(''), null);
});
