import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8');

test('runbook cases.sql is in sync with cases.json', () => {
  const before = read('supabase/runbook/cases.sql');
  execFileSync('node', ['scripts/gen-cases-sql.mjs'], { cwd: WEB });
  assert.equal(read('supabase/runbook/cases.sql'), before, 'run node scripts/gen-cases-sql.mjs and commit');
  const n = (JSON.parse(read('src/lib/entitlements/cases.json')) as unknown[]).length;
  assert.match(before, new RegExp(`expected ${n + 2}\\)`));
});

test('rollout runbook mentions every env var in .env.example', () => {
  const doc = readFileSync(resolve(WEB, '..', '..', 'docs', 'ROLLOUT.md'), 'utf8');
  const names = [...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const exempt = new Set(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  for (const v of names.filter((n) => !exempt.has(n))) assert.ok(doc.includes(v), `ROLLOUT.md missing ${v}`);
});

test('seed script has placeholders only and calls admin_set_plan with pro', () => {
  const sql = read('supabase/runbook/seed-pilot.sql');
  assert.match(sql, /admin_set_plan\(r\.id, 'pro'/);
  assert.match(sql, /REPLACE_WITH_ADMIN_EMAIL/);
  assert.ok(!/najran/i.test(sql));
});
