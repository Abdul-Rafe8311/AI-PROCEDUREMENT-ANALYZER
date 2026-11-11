import { test } from 'node:test';
import assert from 'node:assert/strict';

test('POST without Authorization returns 401 UNAUTHENTICATED and makes no network call', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-key';
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error('network call not expected');
  }) as typeof fetch;
  try {
    const { POST } = await import('./route');
    const res = await POST(new Request('http://localhost/api/ta-form/export-excel', { method: 'POST', body: '{}' }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'UNAUTHENTICATED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
