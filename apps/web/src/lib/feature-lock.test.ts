import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureLockCopy, isFeatureLocked, parsePlanRequired } from './feature-lock';

test('copy names feature, plan and benefit', () => {
  assert.deepEqual(
    [featureLockCopy('chat').name, featureLockCopy('chat').planName],
    ['Chatbox', 'Plus'],
  );
  assert.deepEqual(
    [featureLockCopy('tender_sheet').name, featureLockCopy('tender_sheet').planName],
    ['Tender sheet', 'Pro'],
  );
  assert.ok(featureLockCopy('chat').benefit.length > 10);
});

test('lock matrix', () => {
  const rows: Array<[string, boolean, boolean]> = [
    ['free', true, true],
    ['plus', false, true],
    ['pro', false, false],
    ['max', false, false],
  ];
  for (const [p, chat, tender] of rows) {
    assert.equal(isFeatureLocked(p, 'chat'), chat, `${p} chat`);
    assert.equal(isFeatureLocked(p, 'tender_sheet'), tender, `${p} tender`);
  }
});

test('unknown or missing plan is not locked client-side', () => {
  assert.equal(isFeatureLocked(null, 'chat'), false);
  assert.equal(isFeatureLocked(undefined, 'tender_sheet'), false);
  assert.equal(isFeatureLocked('enterprise', 'chat'), false);
});

test('parsePlanRequired branches on code only', () => {
  assert.equal(parsePlanRequired(403, { code: 'PLAN_REQUIRED', feature: 'chat', error: 'whatever' }), 'chat');
  assert.equal(parsePlanRequired(403, { code: 'PLAN_REQUIRED', feature: 'tender_sheet' }), 'tender_sheet');
  assert.equal(parsePlanRequired(403, { error: 'This feature needs the plus plan' }), null);
  assert.equal(parsePlanRequired(403, { code: 'FORBIDDEN' }), null);
  assert.equal(parsePlanRequired(200, { code: 'PLAN_REQUIRED', feature: 'chat' }), null);
  assert.equal(parsePlanRequired(403, { code: 'PLAN_REQUIRED', feature: 'x' }), null);
  assert.equal(parsePlanRequired(403, null), null);
});
