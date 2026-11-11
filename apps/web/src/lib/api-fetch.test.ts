import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiFetch } from './api-fetch';

function setup(token: string | undefined) {
  const calls: { input: unknown; headers: Headers }[] = [];
  const f = createApiFetch({
    getToken: async () => token,
    fetchImpl: (async (input: unknown, init?: RequestInit) => {
      calls.push({ input, headers: new Headers(init?.headers) });
      return new Response('ok');
    }) as typeof fetch,
    origin: () => 'https://app.test',
  });
  return { f, calls };
}

test('sets Bearer header with a session', async () => {
  const { f, calls } = setup('tok');
  await f('/api/chat', { method: 'POST' });
  assert.equal(calls[0].headers.get('authorization'), 'Bearer tok');
});

test('same-origin absolute URL gets the header', async () => {
  const { f, calls } = setup('tok');
  await f('https://app.test/api/x');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer tok');
});

test('preserves caller Authorization and Content-Type', async () => {
  const { f, calls } = setup('tok');
  await f('/api/x', { headers: { Authorization: 'Bearer mine', 'Content-Type': 'application/json' } });
  assert.equal(calls[0].headers.get('authorization'), 'Bearer mine');
  assert.equal(calls[0].headers.get('content-type'), 'application/json');
  await f('/api/x', { headers: { 'Content-Type': 'application/json' } });
  assert.equal(calls[1].headers.get('content-type'), 'application/json');
  assert.equal(calls[1].headers.get('authorization'), 'Bearer tok');
});

test('no header without a session', async () => {
  const { f, calls } = setup(undefined);
  await f('/api/x');
  assert.equal(calls[0].headers.get('authorization'), null);
});

test('no header for absolute cross-origin or protocol-relative URL', async () => {
  const { f, calls } = setup('tok');
  await f('https://other.example/api/x');
  await f('//other.example/api/x');
  assert.equal(calls[0].headers.get('authorization'), null);
  assert.equal(calls[1].headers.get('authorization'), null);
});
