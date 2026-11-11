import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SRC = resolve(__dirname, '..', '..');
const SERVER = join(SRC, 'lib', 'server');
const ALLOWED = [SERVER, join(SRC, 'lib', 'entitlements'), join(SRC, 'app', 'api')];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const inside = (file: string, dir: string) => file === dir || file.startsWith(dir + sep);

function importsServer(file: string, src: string): boolean {
  const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (/^@\/lib\/server(\/|$)/.test(spec)) return true;
    if (spec.startsWith('.') && inside(resolve(dirname(file), spec), SERVER)) return true;
  }
  return false;
}

test('lib/server is imported only from lib/server, lib/entitlements and app/api', () => {
  const bad = walk(SRC)
    .filter((f) => !ALLOWED.some((d) => inside(f, d)))
    .filter((f) => importsServer(f, readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f));
  assert.deepEqual(bad, [], `forbidden lib/server imports in: ${bad.join(', ')}`);
});

test('boundary detector catches both import styles', () => {
  assert.ok(importsServer(join(SRC, 'components', 'x.tsx'), `import a from '@/lib/server/guard';`));
  assert.ok(importsServer(join(SRC, 'lib', 'y.ts'), `import a from './server/config';`));
  assert.ok(!importsServer(join(SRC, 'lib', 'y.ts'), `import a from './supabase';`));
});
