import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  captchaMessageForAuthError,
  captchaMessageForCode,
  isCaptchaMessage,
  submitBlocked,
  turnstileSiteKey,
} from './captcha';

test('exact user-facing copy', () => {
  assert.equal(CAPTCHA_FAILED_MESSAGE, 'Verification failed. Please try again.');
  assert.equal(CAPTCHA_UNAVAILABLE_MESSAGE, 'Verification is unavailable right now. Please try again in a moment.');
});

test('site key: trimmed, null when absent or blank', () => {
  assert.equal(turnstileSiteKey(' 0x4AAA '), '0x4AAA');
  assert.equal(turnstileSiteKey(''), null);
  assert.equal(turnstileSiteKey('  '), null);
  assert.equal(turnstileSiteKey(undefined), null);
});

test('submit is blocked until a token exists when one is required, and while busy', () => {
  assert.equal(submitBlocked({ required: true, token: null, busy: false }), true);
  assert.equal(submitBlocked({ required: true, token: 't', busy: false }), false);
  assert.equal(submitBlocked({ required: true, token: 't', busy: true }), true);
  assert.equal(submitBlocked({ required: false, token: null, busy: false }), false);
});

test('API codes map to messages; other codes do not', () => {
  assert.equal(captchaMessageForCode('CAPTCHA_FAILED'), CAPTCHA_FAILED_MESSAGE);
  assert.equal(captchaMessageForCode('CAPTCHA_UNAVAILABLE'), CAPTCHA_UNAVAILABLE_MESSAGE);
  assert.equal(captchaMessageForCode('VALIDATION'), null);
  assert.equal(captchaMessageForCode(undefined), null);
});

test('auth errors: rejected token, provider outage with a token, and everything else', () => {
  assert.equal(captchaMessageForAuthError({ code: 'captcha_failed', status: 400, message: 'x' }, true), CAPTCHA_FAILED_MESSAGE);
  assert.equal(captchaMessageForAuthError({ status: 400, message: 'captcha verification process failed' }, false), CAPTCHA_FAILED_MESSAGE);
  assert.equal(captchaMessageForAuthError({ status: 500, message: 'unexpected' }, true), CAPTCHA_UNAVAILABLE_MESSAGE);
  assert.equal(captchaMessageForAuthError({ status: 500, message: 'unexpected' }, false), null);
  assert.equal(captchaMessageForAuthError({ status: 400, message: 'Invalid login credentials' }, true), null);
  assert.equal(captchaMessageForAuthError(null, true), null);
});

test('isCaptchaMessage recognises only the two captcha messages', () => {
  assert.equal(isCaptchaMessage(CAPTCHA_FAILED_MESSAGE), true);
  assert.equal(isCaptchaMessage(CAPTCHA_UNAVAILABLE_MESSAGE), true);
  assert.equal(isCaptchaMessage('Incorrect email or password.'), false);
  assert.equal(isCaptchaMessage(null), false);
});
