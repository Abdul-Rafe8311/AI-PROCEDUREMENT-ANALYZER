import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITEVERIFY_URL, requestHostname, trustedClientIp, verifyTurnstile } from './turnstile';

const secret = () => 'test-secret-value';
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const FAILED = { ok: false, status: 400, code: 'CAPTCHA_FAILED' };
const UNAVAILABLE = { ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' };

test('success posts secret, token and remoteip to siteverify', async () => {
  let seen: { url: string; body: URLSearchParams; method?: string } | null = null;
  const r = await verifyTurnstile('tok', '203.0.113.9', {
    secret,
    fetchImpl: async (url, init) => {
      seen = { url: String(url), body: init!.body as URLSearchParams, method: init!.method };
      return new Response(JSON.stringify({ success: true }));
    },
  });
  assert.deepEqual(r, { ok: true });
  assert.equal(seen!.url, SITEVERIFY_URL);
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.body.get('secret'), 'test-secret-value');
  assert.equal(seen!.body.get('response'), 'tok');
  assert.equal(seen!.body.get('remoteip'), '203.0.113.9');
});

test('remoteip is omitted when no trusted IP is given', async () => {
  let body: URLSearchParams | null = null;
  await verifyTurnstile('tok', undefined, {
    secret,
    fetchImpl: async (_u, init) => {
      body = init!.body as URLSearchParams;
      return new Response(JSON.stringify({ success: true }));
    },
  });
  assert.equal(body!.has('remoteip'), false);
});

test('missing or oversized token is CAPTCHA_FAILED without calling Cloudflare', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called++;
    return new Response('{}');
  };
  for (const t of [undefined, null, '', '   ', 5, 'x'.repeat(2049)]) {
    assert.deepEqual(await verifyTurnstile(t, undefined, { secret, fetchImpl }), FAILED);
  }
  assert.equal(called, 0);
});

test('user-fixable Cloudflare codes are CAPTCHA_FAILED', async () => {
  for (const code of ['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']) {
    assert.deepEqual(await verifyTurnstile('t', undefined, { secret, fetchImpl: reply({ success: false, 'error-codes': [code] }) }), FAILED, code);
  }
});

test('service-side codes, unknown codes and empty failure are CAPTCHA_UNAVAILABLE', async () => {
  for (const codes of [['missing-input-secret'], ['invalid-input-secret'], ['internal-error'], ['bad-request'], ['something-new'], [], ['invalid-input-response', 'internal-error']]) {
    assert.deepEqual(await verifyTurnstile('t', undefined, { secret, fetchImpl: reply({ success: false, 'error-codes': codes }) }), UNAVAILABLE, codes.join());
  }
  assert.deepEqual(await verifyTurnstile('t', undefined, { secret, fetchImpl: reply({ success: false }) }), UNAVAILABLE);
});

test('success must be exactly true', async () => {
  for (const success of ['true', 1, null, 'yes']) {
    assert.equal((await verifyTurnstile('t', undefined, { secret, fetchImpl: reply({ success }) })).ok, false);
  }
});

test('missing secret or config error fails closed as unavailable', async () => {
  assert.deepEqual(await verifyTurnstile('t', undefined, { secret: () => null, fetchImpl: reply({ success: true }) }), UNAVAILABLE);
  assert.deepEqual(
    await verifyTurnstile('t', undefined, { secret: () => { throw new Error('bad'); }, fetchImpl: reply({ success: true }) }),
    UNAVAILABLE,
  );
});

test('http error, non-JSON body and network error are unavailable, never a pass', async () => {
  assert.deepEqual(await verifyTurnstile('t', undefined, { secret, fetchImpl: reply({ success: true }, 500) }), UNAVAILABLE);
  assert.deepEqual(await verifyTurnstile('t', undefined, { secret, fetchImpl: async () => new Response('<html>') }), UNAVAILABLE);
  assert.deepEqual(await verifyTurnstile('t', undefined, { secret, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), UNAVAILABLE);
});

test('a hung Cloudflare is aborted after the timeout and is unavailable', async () => {
  const started = Date.now();
  const r = await verifyTurnstile('t', undefined, {
    secret,
    timeoutMs: 30,
    fetchImpl: (_u, init) =>
      new Promise<Response>((_res, rej) => {
        init!.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
  });
  assert.deepEqual(r, UNAVAILABLE);
  assert.ok(Date.now() - started < 2000);
});

test('logs never contain the token or the secret', async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(' '));
  try {
    await verifyTurnstile('SECRET-TOKEN-123', undefined, { secret, fetchImpl: reply({ success: false, 'error-codes': ['invalid-input-response'] }) });
    await verifyTurnstile('SECRET-TOKEN-123', undefined, { secret, fetchImpl: async () => { throw new Error('SECRET-TOKEN-123 test-secret-value'); } });
  } finally {
    console.error = orig;
  }
  assert.ok(logged.length >= 2);
  for (const l of logged) assert.ok(!l.includes('SECRET-TOKEN-123') && !l.includes('test-secret-value'), l);
});

test('trustedClientIp accepts one valid IP from x-real-ip only', () => {
  const r = (h: Record<string, string>) => new Request('http://x', { headers: h });
  assert.equal(trustedClientIp(r({ 'x-real-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(trustedClientIp(r({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1');
  assert.equal(trustedClientIp(r({ 'x-real-ip': '1.2.3.4, 5.6.7.8' })), undefined);
  assert.equal(trustedClientIp(r({ 'x-real-ip': '999.1.1.1' })), undefined);
  assert.equal(trustedClientIp(r({ 'x-real-ip': 'not-an-ip' })), undefined);
  assert.equal(trustedClientIp(r({ 'x-forwarded-for': '203.0.113.9' })), undefined);
  assert.equal(trustedClientIp(r({})), undefined);
});

test('a token minted for another action is rejected when an action is expected', async () => {
  const f = reply({ success: true, action: 'login', hostname: 'app.example.test' });
  assert.deepEqual(await verifyTurnstile('tok', undefined, { secret, fetchImpl: f }, { action: 'payment' }), FAILED);
  const none = reply({ success: true, hostname: 'app.example.test' });
  assert.deepEqual(await verifyTurnstile('tok', undefined, { secret, fetchImpl: none }, { action: 'payment' }), FAILED);
  const ok = reply({ success: true, action: 'payment', hostname: 'app.example.test' });
  assert.deepEqual(await verifyTurnstile('tok', undefined, { secret, fetchImpl: ok }, { action: 'payment' }), { ok: true });
});

test('a token solved on another hostname is rejected; localhost skips the check', async () => {
  const f = reply({ success: true, action: 'payment', hostname: 'evil.example.test' });
  assert.deepEqual(await verifyTurnstile('tok', undefined, { secret, fetchImpl: f }, { hostname: 'app.example.test' }), FAILED);
  assert.deepEqual(await verifyTurnstile('tok', undefined, { secret, fetchImpl: f }, { hostname: 'localhost' }), { ok: true });
});

test('requestHostname prefers x-forwarded-host and drops the port', () => {
  const r = new Request('http://x/y', { headers: { host: 'internal:3000', 'x-forwarded-host': 'App.Example.test:443' } });
  assert.equal(requestHostname(r), 'app.example.test');
});
