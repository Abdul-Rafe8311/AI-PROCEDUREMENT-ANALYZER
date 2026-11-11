import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = __dirname;
const CLASSES = ['jwt', 'feature:chat', 'feature:tender_sheet', 'admin', 'apikey', 'token-link', 'cron', 'public'];

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routes(p);
    return n === 'route.ts' ? [p] : [];
  });
}

const REQUIRED: Record<string, string> = {
  'ta-form/export-excel': 'public',
  'me/entitlements': 'jwt',
  approve: 'token-link',
  dashboard: 'token-link',
  fx: 'public',
  intake: 'public',
  extract: 'public',
  chat: 'public',
  'doc-answer': 'public',
  'tender-sheet/fill': 'public',
  'tender-sheet/export': 'public',
};

const files = routes(ROOT);
const info = files.map((f) => {
  const src = readFileSync(f, 'utf8');
  const name = relative(ROOT, f).replace(/\/route\.ts$/, '');
  const m = /^\/\/ guard: (\S+)\s*$/m.exec(src.split('\n').slice(0, 3).join('\n'));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return { name, src, code, marker: m?.[1] };
});

test('every route has a valid guard marker', () => {
  for (const r of info) {
    assert.ok(r.marker, `route ${r.name} has no "// guard: <class>" marker`);
    assert.ok(CLASSES.includes(r.marker!), `route ${r.name} has invalid guard class "${r.marker}"`);
  }
});

test('named routes carry their required class', () => {
  for (const [name, cls] of Object.entries(REQUIRED)) {
    const r = info.find((i) => i.name === name);
    assert.ok(r, `route ${name} not found`);
    assert.equal(r!.marker, cls, `route ${name} must be "${cls}"`);
  }
});

test('marker agrees with the guard helper called', () => {
  for (const r of info) {
    const calls = (fn: string) => new RegExp(`\\b${fn}\\s*\\(`).test(r.code);
    const wantsJwt = r.marker === 'jwt' || r.marker === 'apikey';
    if (wantsJwt) assert.ok(calls('requirePrincipal'), `route ${r.name} is "${r.marker}" but never calls requirePrincipal`);
    if (r.marker!.startsWith('feature:')) assert.ok(calls('requireFeature'), `route ${r.name} is "${r.marker}" but never calls requireFeature`);
    if (r.marker === 'admin') assert.ok(calls('requireAdmin'), `route ${r.name} is "admin" but never calls requireAdmin`);
    if (r.marker === 'jwt') {
      const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+requirePrincipal\s*\(/.exec(r.code);
      assert.ok(m, `route ${r.name} must assign the requirePrincipal result`);
      if (m) assert.ok(new RegExp(`if\\s*\\(\\s*!\\s*${m[1]}\\.ok\\s*\\)\\s*return\\b`).test(r.code), `route ${r.name} must return early on !${m[1]}.ok`);
    }
    if (r.marker === 'public' || r.marker === 'token-link') {
      for (const fn of ['requirePrincipal', 'requireFeature', 'requireAdmin']) {
        assert.ok(!calls(fn), `route ${r.name} is "${r.marker}" but calls ${fn}`);
      }
    }
  }
});
