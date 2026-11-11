import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from './config';

test('production with missing Supabase vars throws ConfigError', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }), ConfigError);
});

test('non-production returns config without Supabase vars', () => {
  const c = loadConfig({ NODE_ENV: 'development' });
  assert.equal(c.production, false);
  assert.equal(c.supabaseUrl, null);
});

test('production with Supabase vars returns config', () => {
  const c = loadConfig({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' });
  assert.equal(c.supabaseAnonKey, 'k');
});

test('malformed JSON vars are reported', () => {
  const env = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'u', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' };
  assert.throws(() => loadConfig({ ...env, BANK_DETAILS: '{nope' }), /BANK_DETAILS/);
  assert.throws(() => loadConfig({ ...env, PLAN_PRICES_USD: '[' }), /PLAN_PRICES_USD/);
});

test('ADMIN_EMAILS is trimmed and lower-cased', () => {
  assert.deepEqual(loadConfig({ NODE_ENV: 'test', ADMIN_EMAILS: ' A@B.com ,' }).adminEmails, ['a@b.com']);
});

test('allowDemo is true only for ALLOW_DEMO=true, in any NODE_ENV', () => {
  assert.equal(loadConfig({}).allowDemo, false);
  assert.equal(loadConfig({ ALLOW_DEMO: '1' }).allowDemo, false);
  assert.equal(loadConfig({ ALLOW_DEMO: 'true' }).allowDemo, true);
});

test('production rejects ALLOW_DEMO=true even with Supabase configured', () => {
  const env = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' };
  assert.throws(() => loadConfig({ ...env, ALLOW_DEMO: 'true' }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ALLOW_DEMO: 'true' }), ConfigError);
});
