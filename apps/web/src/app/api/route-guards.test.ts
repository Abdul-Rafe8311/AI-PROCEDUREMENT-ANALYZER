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
  'admin/users': 'admin',
  'billing/config': 'jwt',
  payments: 'jwt',
  'admin/payments': 'admin',
  'admin/payments/[id]/decide': 'admin',
  'payments/[id]/screenshot': 'jwt',
  'cron/daily': 'cron',
  approve: 'token-link',
  dashboard: 'token-link',
  fx: 'public',
  intake: 'public',
  extract: 'apikey',
  'admin/api-keys': 'admin',
  chat: 'feature:chat',
  'doc-answer': 'feature:chat',
  'tender-sheet/fill': 'feature:tender_sheet',
  'tender-sheet/export': 'feature:tender_sheet',
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
    if (r.marker === 'cron') assert.ok(calls('requireCron'), `route ${r.name} is "cron" but never calls requireCron`);
    if (r.marker === 'admin') assert.ok(calls('requireAdmin'), `route ${r.name} is "admin" but never calls requireAdmin`);
    if (r.marker === 'apikey') assert.ok(/allowApiKey\s*:\s*true/.test(r.code), `route ${r.name} is "apikey" but never passes allowApiKey: true`);
    if (r.marker !== 'apikey') assert.ok(!/allowApiKey/.test(r.code), `route ${r.name} is "${r.marker}" but passes allowApiKey`);
    if (r.marker === 'cron') {
      const m = /(?:const|let)\s+(\w+)\s*=\s*requireCron\s*\(/.exec(r.code);
      assert.ok(m, `route ${r.name} must assign the requireCron result`);
      if (m) assert.ok(new RegExp(`if\\s*\\(\\s*!\\s*${m[1]}\\.ok\\s*\\)\\s*return\\b`).test(r.code), `route ${r.name} must return early on !${m[1]}.ok`);
      assert.ok(/export const dynamic\s*=\s*'force-dynamic'/.test(r.code), `route ${r.name} must be force-dynamic`);
    }
    if (r.marker === 'jwt' || r.marker === 'admin' || r.marker === 'apikey') {
      const fn = r.marker === 'admin' ? 'requireAdmin' : 'requirePrincipal';
      const m = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+${fn}\\s*\\(`).exec(r.code);
      assert.ok(m, `route ${r.name} must assign the ${fn} result`);
      if (m) assert.ok(new RegExp(`if\\s*\\(\\s*!\\s*${m[1]}\\.ok\\s*\\)\\s*return\\b`).test(r.code), `route ${r.name} must return early on !${m[1]}.ok`);
    }
    if (r.marker === 'public' || r.marker === 'token-link') {
      for (const fn of ['requirePrincipal', 'requireFeature', 'requireAdmin', 'requireCron']) {
        assert.ok(!calls(fn), `route ${r.name} is "${r.marker}" but calls ${fn}`);
      }
    }
  }
});

// Gated routes: the plan gate is only real if the result is assigned, checked with an early return, and asks for
// the feature the marker names (so `chat` cannot quietly call requireFeature(req, 'tender_sheet') or none at all).
test('feature routes assign requireFeature, return early on !ok and pass the marker feature id', () => {
  const gated = info.filter((r) => r.marker!.startsWith('feature:'));
  assert.ok(gated.length >= 4, 'expected the four gated routes');
  for (const r of gated) {
    const feature = r.marker!.slice('feature:'.length);
    const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+requireFeature\s*\(\s*[^,()]+,\s*['"]([a-z_]+)['"]/.exec(r.code);
    assert.ok(m, `route ${r.name} must assign await requireFeature(req, '<feature>')`);
    if (!m) continue;
    assert.equal(m[2], feature, `route ${r.name} is "${r.marker}" but requires feature "${m[2]}"`);
    assert.ok(
      new RegExp(`if\\s*\\(\\s*!\\s*${m[1]}\\.ok\\s*\\)\\s*return\\s+${m[1]}\\.response\\b`).test(r.code),
      `route ${r.name} must return ${m[1]}.response on !${m[1]}.ok`,
    );
  }
});

test('the guard runs before any other work in each gated handler', () => {
  for (const r of info.filter((i) => i.marker!.startsWith('feature:'))) {
    const post = /export async function POST\s*\([^)]*\)\s*\{([\s\S]*)/.exec(r.code);
    assert.ok(post, `route ${r.name} has no POST handler`);
    const at = (post as RegExpExecArray)[1].search(/requireFeature\s*\(/);
    const first = (post as RegExpExecArray)[1].search(/\b(req\.(json|formData|text)|await\s+(?!requireFeature))/);
    assert.ok(at >= 0 && (first < 0 || at <= first), `route ${r.name} does work before requireFeature`);
  }
});
