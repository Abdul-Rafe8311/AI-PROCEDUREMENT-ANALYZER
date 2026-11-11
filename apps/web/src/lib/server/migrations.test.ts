import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 5).sort();

test('0005+ migrations exist', () => assert.ok(files.length >= 1));

for (const f of files) {
  const sql = readFileSync(join(DIR, f), 'utf8').replace(/--.*$/gm, '');

  test(`${f}: every create function revokes public/anon/authenticated, grants service_role, fixes search_path`, () => {
    const re = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const name = m[1].replace(/^public\./, '');
      const esc = name.replace(/\./g, '\\.');
      const body = sql.slice(m.index, sql.indexOf(';', sql.indexOf('$$', sql.indexOf('$$', m.index) + 2)) + 1 || undefined);
      assert.match(body, /set\s+search_path\s*=/i, `${f}: ${name} needs fixed search_path`);
      assert.match(sql, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${esc}\\s*\\([^)]*\\)\\s+from\\s+[^;]*public[^;]*anon[^;]*authenticated`, 'i'), `${f}: ${name} must revoke execute`);
      assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${esc}\\s*\\([^)]*\\)\\s+to\\s+service_role\\s*;`, 'i'), `${f}: ${name} must grant only service_role`);
    }
  });

  test(`${f}: RLS enabled on created tables and no write policies`, () => {
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi;
    let m;
    while ((m = re.exec(sql))) {
      assert.match(sql, new RegExp(`alter\\s+table\\s+(?:public\\.)?${m[1]}\\s+enable\\s+row\\s+level\\s+security`, 'i'), `${f}: RLS missing on ${m[1]}`);
    }
    assert.ok(!/create\s+policy[^;]*\bfor\s+(insert|update|delete|all)\b/i.test(sql), `${f}: write policy found`);
  });
}

test('0005 specifics', () => {
  const sql = readFileSync(join(DIR, '0005_subscriptions.sql'), 'utf8');
  assert.match(sql, /plan_periods_no_overlap/);
  assert.match(sql, /btree_gist/);
  assert.ok(!/policy[^;]*audit_log/i.test(sql.replace(/--.*$/gm, '')), 'audit_log must have no user policy');
});

test('0009-0011 are additive: no drop, delete, truncate or destructive alter', () => {
  for (const f of files.filter((x) => Number(x.slice(0, 4)) >= 9)) {
    const sql = readFileSync(join(DIR, f), 'utf8').replace(/--.*$/gm, '');
    assert.ok(!/\bdrop\s+(table|column|function|index|type|schema|constraint)\b/i.test(sql), `${f}: drop found`);
    assert.ok(!/\btruncate\b/i.test(sql), `${f}: truncate found`);
    assert.ok(!/\bdelete\s+from\b/i.test(sql), `${f}: delete found`);
    assert.ok(!/\balter\s+table[^;]*\bdrop\b/i.test(sql), `${f}: alter ... drop found`);
  }
});

test('0009 payment_requests: one pending per user, non-unique transaction id, private bucket', () => {
  const sql = readFileSync(join(DIR, '0009_payment_requests.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /unique index if not exists payment_requests_one_pending_idx[\s\S]*where status = 'pending'/i);
  assert.match(sql, /create index if not exists payment_requests_transaction_id_idx/i);
  assert.ok(!/unique[^;]*transaction_id/i.test(sql), 'transaction_id must not be unique');
  assert.match(sql, /'payment-proofs', 'payment-proofs', false/);
});

test('0010 email_log: reminder uniqueness only, no user policy', () => {
  const sql = readFileSync(join(DIR, '0010_email_log.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /unique index if not exists email_log_reminder_once_idx[\s\S]*where template = 'expiry_reminder'/i);
  assert.ok(!/create\s+policy/i.test(sql));
});

test('0011 decide_payment_request: takes the shared per-user lock and writes audit', () => {
  const sql = readFileSync(join(DIR, '0011_decide_payment_request.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_user::text, 0\)\)/);
  assert.match(sql, /'payment_approved'/);
  assert.match(sql, /'payment_rejected'/);
  assert.match(sql, /ALREADY_DECIDED/);
  assert.ok(!/delete\s+from/i.test(sql));
});
