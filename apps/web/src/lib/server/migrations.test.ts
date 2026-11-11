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
