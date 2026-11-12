import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireCron } from './guard';

const req = (auth?: string) => new Request('http://localhost/api/cron/daily', { headers: auth ? { authorization: auth } : {} });
const secret = () => 's3cret-value';

test('correct bearer passes', () => {
  assert.deepEqual(requireCron(req('Bearer s3cret-value'), { secret }), { ok: true });
});

for (const [name, h] of [['missing', undefined], ['wrong', 'Bearer nope'], ['malformed', 's3cret-value'], ['prefix of secret', 'Bearer s3cret']] as const) {
  test(`${name} header is 401 and does nothing`, async () => {
    const r = requireCron(req(h), { secret });
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.response.status, 401);
      assert.equal(((await r.response.json()) as { code: string }).code, 'UNAUTHENTICATED');
    }
  });
}

test('an unset secret fails closed with 503, even when a token is sent', () => {
  for (const s of [null, '']) {
    const r = requireCron(req('Bearer anything'), { secret: () => s });
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.response.status, 503);
  }
});

test('a config error is 503', () => {
  const r = requireCron(req('Bearer x'), { secret: () => { throw new Error('boom'); } });
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 503);
});
