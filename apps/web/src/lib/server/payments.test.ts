import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listOwnPayments, screenshotUrl, sniffProof, submitPayment, type PaymentRow, type PaymentsStore } from './payments';
import type { Principal } from './guard';

const user: Principal = { userId: '11111111-1111-1111-1111-111111111111', email: 'u@example.test', via: 'jwt' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const PDF = new TextEncoder().encode('%PDF-1.7 fake');
const prices = { plus: 6, pro: 12, max: 30 };
const pass = async () => ({ ok: true }) as const;

function fakeStore(over: Partial<PaymentsStore> = {}) {
  const calls = { uploaded: [] as string[], removed: [] as string[], inserted: [] as unknown[] };
  const store: PaymentsStore = {
    async upload(path) { calls.uploaded.push(path); },
    async remove(path) { calls.removed.push(path); },
    async insert(row) { calls.inserted.push(row); return 'ok'; },
    async list() { return { rows: [], total: 0 }; },
    async pending() { return null; },
    async get() { return null; },
    async signedUrl() { return 'https://signed.example.test/x'; },
    ...over,
  };
  return { store, calls };
}

function req(fields: Record<string, string | Uint8Array | undefined>, type = 'image/png') {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === 'string') f.set(k, v);
    else f.set(k, new Blob([v as BlobPart], { type }), 'receipt.bin');
  }
  return new Request('http://localhost/api/payments', { method: 'POST', body: f });
}
const good = { plan: 'pro', transactionId: 'TX-123', file: PNG };
const body = async (r: Response) => (await r.json()) as Record<string, any>;

test('sniffProof reads magic bytes, ignores everything else', () => {
  assert.equal(sniffProof(PNG)?.ext, 'png');
  assert.equal(sniffProof(JPG)?.ext, 'jpg');
  assert.equal(sniffProof(PDF)?.ext, 'pdf');
  assert.equal(sniffProof(new TextEncoder().encode('<html>')), null);
  assert.equal(sniffProof(new Uint8Array([])), null);
});

test('valid submission uploads to <user>/<id>.<ext>, copies the price and returns 201', async () => {
  const { store, calls } = fakeStore();
  const r = await submitPayment(req(good), user, { store, rawPrices: prices, verifyCaptcha: pass, newId: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  assert.equal(r.status, 201);
  assert.deepEqual(calls.uploaded, [`${user.userId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`]);
  assert.equal((calls.inserted[0] as { amount_usd: number }).amount_usd, 12);
  assert.equal((await body(r)).request.status, 'pending');
});

test('missing fields give 400 VALIDATION with field-level errors and nothing is uploaded', async () => {
  const { store, calls } = fakeStore();
  const r = await submitPayment(req({}), user, { store, rawPrices: prices, verifyCaptcha: pass });
  assert.equal(r.status, 400);
  const b = await body(r);
  assert.equal(b.code, 'VALIDATION');
  assert.deepEqual(Object.keys(b.fields).sort(), ['file', 'plan', 'transactionId']);
  assert.equal(calls.uploaded.length, 0);
});

test('free or unknown plan is rejected', async () => {
  const { store } = fakeStore();
  for (const plan of ['free', 'gold', '']) {
    const r = await submitPayment(req({ ...good, plan }), user, { store, rawPrices: prices, verifyCaptcha: pass });
    assert.equal(r.status, 400);
    assert.ok((await body(r)).fields.plan);
  }
});

test('transaction id: blank, too long or with control characters is rejected', async () => {
  const { store } = fakeStore();
  for (const t of ['   ', 'x'.repeat(101), 'a\u0000b']) {
    const r = await submitPayment(req({ ...good, transactionId: t }), user, { store, rawPrices: prices, verifyCaptcha: pass });
    assert.equal(r.status, 400, JSON.stringify(t));
  }
});

test('a spoofed file (html declared as png) is rejected by magic bytes', async () => {
  const { store, calls } = fakeStore();
  const r = await submitPayment(req({ ...good, file: new TextEncoder().encode('<html>x</html>') }), user, { store, rawPrices: prices, verifyCaptcha: pass });
  assert.equal(r.status, 400);
  assert.match((await body(r)).fields.file, /PNG, JPG or PDF/);
  assert.equal(calls.uploaded.length, 0);
});

test('a file over 5 MB is rejected with the limit stated', async () => {
  const { store } = fakeStore();
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(PNG);
  const r = await submitPayment(req({ ...good, file: big }), user, { store, rawPrices: prices, verifyCaptcha: pass });
  assert.equal(r.status, 400);
  assert.match((await body(r)).fields.file, /limit is 5 MB/);
});

test('exactly 5 MB is accepted', async () => {
  const { store } = fakeStore();
  const ok = new Uint8Array(5 * 1024 * 1024);
  ok.set(PNG);
  assert.equal((await submitPayment(req({ ...good, file: ok }), user, { store, rawPrices: prices, verifyCaptcha: pass })).status, 201);
});

test('no configured price: 503 PAYMENTS_UNAVAILABLE and nothing uploaded', async () => {
  const { store, calls } = fakeStore();
  for (const rawPrices of [null, { pro: 'x' }, { pro: 12.5 }]) {
    const r = await submitPayment(req(good), user, { store, rawPrices, verifyCaptcha: pass });
    assert.equal(r.status, 503);
    assert.equal((await body(r)).code, 'PAYMENTS_UNAVAILABLE');
  }
  assert.equal(calls.uploaded.length, 0);
});

test('a second pending request is 409 and the uploaded object is removed', async () => {
  const { store, calls } = fakeStore({ async insert() { return 'pending_exists'; } });
  const r = await submitPayment(req(good), user, { store, rawPrices: prices, verifyCaptcha: pass });
  assert.equal(r.status, 409);
  assert.equal((await body(r)).code, 'PENDING_REQUEST_EXISTS');
  assert.equal(calls.removed.length, 1);
  assert.equal(calls.removed[0], calls.uploaded[0]);
});

test('insert failure removes the object and returns 503', async () => {
  const { store, calls } = fakeStore({ async insert() { throw new Error('db'); } });
  const r = await submitPayment(req(good), user, { store, rawPrices: prices, verifyCaptcha: pass });
  assert.equal(r.status, 503);
  assert.deepEqual(calls.removed, calls.uploaded);
});

test('upload failure inserts nothing and removes nothing', async () => {
  const { store, calls } = fakeStore({ async upload() { throw new Error('storage'); } });
  const r = await submitPayment(req(good), user, { store, rawPrices: prices, verifyCaptcha: pass });
  assert.equal(r.status, 503);
  assert.equal(calls.inserted.length, 0);
  assert.equal(calls.removed.length, 0);
});

test('afterCommit runs once after the insert; its failure never changes the 201 or removes the object', async () => {
  const { store, calls } = fakeStore();
  let ran = 0;
  const r = await submitPayment(req(good), user, {
    verifyCaptcha: pass,
    store, rawPrices: prices,
    afterCommit: async () => { ran++; throw new Error('mail down'); },
  });
  assert.equal(r.status, 201);
  assert.equal(ran, 1);
  assert.equal(calls.removed.length, 0);
});

const row = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: '22222222-2222-2222-2222-222222222222', user_id: user.userId, plan: 'pro', amount_usd: 12, transaction_id: 'T',
  screenshot_path: `${user.userId}/x.png`, status: 'pending', decided_by: null, decided_at: null, reject_reason: null,
  created_at: '2026-11-12T10:00:00Z', ...over,
});

test('history: pagination is clamped and the pending request is reported', async () => {
  let seen: [number, number] = [0, 0];
  const { store } = fakeStore({
    async list(_u, offset, limit) { seen = [offset, limit]; return { rows: [row()], total: 31 }; },
    async pending() { return row(); },
  });
  const r = await listOwnPayments(new Request('http://x/api/payments?page=3&pageSize=9999'), user, store);
  const b = await body(r);
  assert.deepEqual(seen, [100, 50]);
  assert.equal(b.total, 31);
  assert.equal(b.pending.plan, 'pro');
  assert.ok(!JSON.stringify(b).includes(user.userId + '/x.png'), 'storage path must not leak');
  const bad = await listOwnPayments(new Request('http://x/api/payments?page=-4&pageSize=abc'), user, store);
  assert.equal((await body(bad)).page, 1);
});

test('screenshot: owner gets a 60 s URL, admin too, a stranger and an unknown id get 403', async () => {
  const mine = row();
  const { store } = fakeStore({ async get(id) { return id === mine.id ? mine : null; } });
  const ok = await screenshotUrl(user, mine.id, false, store);
  assert.equal(ok.status, 200);
  assert.equal((await body(ok)).expiresIn, 60);
  const other: Principal = { userId: '33333333-3333-3333-3333-333333333333', email: 'o@example.test', via: 'jwt' };
  assert.equal((await screenshotUrl(other, mine.id, false, store)).status, 403);
  assert.equal((await screenshotUrl(other, mine.id, true, store)).status, 200);
  assert.equal((await screenshotUrl(user, '44444444-4444-4444-4444-444444444444', false, store)).status, 403);
  assert.equal((await screenshotUrl(user, 'not-a-uuid', false, store)).status, 403);
});

test('screenshot: a request whose file was removed is 404 SCREENSHOT_REMOVED with the retention message', async () => {
  const { store } = fakeStore({ async get() { return row({ screenshot_path: null }); } });
  const r = await screenshotUrl(user, row().id, false, store);
  assert.equal(r.status, 404);
  const b = (await r.json()) as { code: string; error: string };
  assert.equal(b.code, 'SCREENSHOT_REMOVED');
  assert.equal(b.error, 'Screenshot removed after 12 months.');
});

test('captcha runs before validation and upload; token comes from cf-turnstile-response', async () => {
  const { store, calls } = fakeStore();
  const seen: unknown[] = [];
  const r = await submitPayment(req({ ...good, 'cf-turnstile-response': 'tok-1' }), user, {
    store,
    rawPrices: prices,
    verifyCaptcha: async (t) => {
      seen.push(t);
      return { ok: true };
    },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(seen, ['tok-1']);
  assert.equal(calls.uploaded.length, 1);
});

test('captcha failure is 400 CAPTCHA_FAILED and nothing is uploaded or inserted, even with an invalid form', async () => {
  for (const fields of [good, {}]) {
    const { store, calls } = fakeStore();
    const r = await submitPayment(req(fields), user, {
      store,
      rawPrices: prices,
      verifyCaptcha: async () => ({ ok: false, status: 400, code: 'CAPTCHA_FAILED' }),
    });
    assert.equal(r.status, 400);
    assert.equal((await body(r)).code, 'CAPTCHA_FAILED');
    assert.deepEqual([calls.uploaded.length, calls.inserted.length], [0, 0]);
  }
});

test('captcha unavailable is 503 CAPTCHA_UNAVAILABLE and never lets the request through', async () => {
  const { store, calls } = fakeStore();
  const r = await submitPayment(req(good), user, {
    store,
    rawPrices: prices,
    verifyCaptcha: async () => ({ ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' }),
  });
  assert.equal(r.status, 503);
  assert.equal((await body(r)).code, 'CAPTCHA_UNAVAILABLE');
  assert.deepEqual([calls.uploaded.length, calls.inserted.length], [0, 0]);
});
