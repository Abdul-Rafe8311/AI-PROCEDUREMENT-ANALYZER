// Static guard (AD-9): the three native-auth forms use the shared captcha hook, pass its token to the
// auth call, and never block-free bypass it. No custom verifier exists for these flows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const pages: Array<[string, string]> = [
  ['app/(auth)/login/page.tsx', 'signIn('],
  ['app/(auth)/signup/page.tsx', 'signUp('],
  ['app/(auth)/forgot-password/page.tsx', 'sendPasswordReset('],
];

for (const [file, call] of pages) {
  test(`${file} gates submit on the widget and passes the token to Supabase`, () => {
    const src = read(file);
    assert.match(src, /useCaptchaField\(\)/);
    assert.ok(src.includes('captcha.node'), 'widget must be rendered');
    assert.match(src, /captcha\.waiting/, 'submit must wait for a token');
    assert.match(src, new RegExp(`${call.replace('(', '\\(')}[^)]*captcha\\.token\\)`), 'token must reach the auth call');
    assert.match(src, /captcha\.settle\(/, 'token is single-use: reset after a failed attempt');
  });
}

test('auth context forwards the token as options.captchaToken for all three calls', () => {
  const src = read('lib/auth-context.tsx');
  assert.equal((src.match(/captchaToken/g) ?? []).length >= 9, true);
  assert.match(src, /signInWithPassword\(\{[\s\S]*options: \{ captchaToken \}/);
  assert.match(src, /resetPasswordForEmail\([\s\S]*captchaToken/);
});

test('no custom verifier for auth flows: siteverify lives only in lib/server/turnstile.ts', () => {
  const offenders = ['lib/auth-context.tsx', 'components/auth/captcha-field.tsx', 'components/turnstile-widget.tsx'].filter((f) =>
    read(f).includes('siteverify'),
  );
  assert.deepEqual(offenders, []);
});
