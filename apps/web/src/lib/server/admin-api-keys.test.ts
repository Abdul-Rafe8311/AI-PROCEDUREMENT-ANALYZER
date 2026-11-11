import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiKeyCreate, buildApiKeyRevoke } from './admin-api-keys';
import { generateApiKey, hashApiKey } from './api-keys';

const UID = '11111111-1111-4111-8111-111111111111';
const admin = { userId: 'a', email: 'admin@x.test', via: 'jwt' as const };
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) });

test('keys are random, prefixed and hashed to 64 hex', () => {
  const a = generateApiKey();
  assert.match(a, /^ak_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, generateApiKey());
  assert.match(hashApiKey(a), /^[0-9a-f]{64}$/);
});

test('create returns the raw key once; only its hash is stored; audit carries no key', async () => {
  const stored: unknown[] = [];
  const audits: unknown[] = [];
  const res = await buildApiKeyCreate(post({ userId: UID, label: ' pilot ' }), admin, {
    userExists: async () => true,
    generate: () => 'ak_rawvalue',
    insertKey: async (a) => (stored.push(a), 'key-id'),
    audit: async (a) => void audits.push(a),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.key, 'ak_rawvalue');
  assert.deepEqual(stored, [{ userId: UID, sha256: hashApiKey('ak_rawvalue'), label: 'pilot' }]);
  assert.ok(!JSON.stringify(stored).includes('ak_rawvalue'));
  assert.ok(!JSON.stringify(audits).includes('ak_rawvalue'));
});

test('create validates user id and 404s unknown users', async () => {
  const bad = await buildApiKeyCreate(post({ userId: 'nope' }), admin, {});
  assert.equal(bad.status, 400);
  const missing = await buildApiKeyCreate(post({ userId: UID }), admin, { userExists: async () => false });
  assert.equal(missing.status, 404);
});

test('create failure is 503 and leaks nothing', async () => {
  const res = await buildApiKeyCreate(post({ userId: UID }), admin, {
    userExists: async () => true,
    insertKey: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(res.status, 503);
  assert.ok(!JSON.stringify(await res.json()).includes('boom'));
});

test('revoke sets revoked via the helper, 404 when not live, 400 on bad id', async () => {
  const ok = await buildApiKeyRevoke(post({ id: UID }), admin, { revokeKey: async () => true, audit: async () => {} });
  assert.equal(ok.status, 200);
  const nf = await buildApiKeyRevoke(post({ id: UID }), admin, { revokeKey: async () => false });
  assert.equal(nf.status, 404);
  assert.equal((await buildApiKeyRevoke(post({}), admin, {})).status, 400);
});
