// Password strength rules for sign-up: minimum length + basic variety. Supabase
// does the hashing; this is the client-side UX guard that stops obviously weak
// passwords before submit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPassword, MIN_PASSWORD_LENGTH } from './password';
import { isEmailAllowedToSignUp, ALLOWED_SIGNUP_DOMAIN } from './auth-policy';

test('too short → not ok, weak, flags the length rule', () => {
  const a = assessPassword('Ab1');
  assert.equal(a.ok, false);
  assert.equal(a.label, 'weak');
  assert.ok(a.issues.some((i) => new RegExp(`${MIN_PASSWORD_LENGTH} characters`).test(i)));
});

test('long but single character-class → not ok (needs variety)', () => {
  const a = assessPassword('abcdefghijkl');
  assert.equal(a.ok, false);
  assert.ok(a.issues.some((i) => /numbers or symbols/.test(i)));
  assert.ok(a.score <= 1, `single-class password stays weak: ${a.score}`);
});

test('8+ chars with letters+digits → ok (fair or better)', () => {
  const a = assessPassword('anchors1');
  assert.equal(a.ok, true);
  assert.equal(a.issues.length, 0);
  assert.ok(a.score >= 2);
});

test('long, mixed-class password → strong', () => {
  const a = assessPassword('Anchors!2026#Farid');
  assert.equal(a.ok, true);
  assert.equal(a.label, 'strong');
  assert.equal(a.score, 4);
});

test('common weak "12345678" → not ok (only digits = one class)', () => {
  const a = assessPassword('12345678');
  assert.equal(a.ok, false);
});

test('domain policy is OPEN by default — any email may sign up', () => {
  assert.equal(ALLOWED_SIGNUP_DOMAIN, null, 'default policy is open (null)');
  assert.equal(isEmailAllowedToSignUp('anyone@gmail.com'), true);
  assert.equal(isEmailAllowedToSignUp('farid@somewhere.co'), true);
});
