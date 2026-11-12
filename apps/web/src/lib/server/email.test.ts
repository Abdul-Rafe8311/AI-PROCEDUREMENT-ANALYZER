import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyAdminsPaymentSubmitted, sendEmail, type EmailLogStore } from './email';
import { renderEmail, esc } from './email-templates';

function logStore() {
  const rows: Array<{ id: string; template: string; to: string; subjectId: string | null; status: string; error: string | null }> = [];
  const store: EmailLogStore = {
    async start(r) {
      const id = `row${rows.length + 1}`;
      rows.push({ id, template: r.template, to: r.to, subjectId: r.subjectId, status: 'pending', error: null });
      return id;
    },
    async finish(id, status, error) {
      const r = rows.find((x) => x.id === id)!;
      r.status = status;
      r.error = error;
    },
  };
  return { store, rows };
}
const cfg = () => ({ resendApiKey: 're_test', emailFrom: 'AI Procurement <billing@example.test>' });
const admin = { userEmail: 'u@example.test', plan: 'pro', amountUsd: 12, adminUrl: 'https://app.example.test/admin' };

test('a successful send uses EMAIL_FROM and logs sent', async () => {
  const { store, rows } = logStore();
  let sent: { from: string; to: string; subject: string } | null = null;
  const r = await sendEmail('payment_submitted_admin', 'a@example.test', admin, { subjectId: 'req1' }, {
    config: cfg, log: store, send: async (m) => { sent = m; return { error: null }; },
  });
  assert.deepEqual(r, { ok: true, status: 'sent' });
  assert.equal(sent!.from, 'AI Procurement <billing@example.test>');
  assert.match(sent!.subject, /New payment request: Pro from u@example\.test/);
  assert.deepEqual(rows.map((x) => [x.status, x.subjectId]), [['sent', 'req1']]);
});

test('a Resend response carrying error is recorded as failed and never throws', async () => {
  const { store, rows } = logStore();
  const r = await sendEmail('payment_approved', 'u@example.test', { plan: 'pro', expiresOn: '11 Dec 2026' }, {}, {
    config: cfg, log: store, send: async () => ({ error: { message: 'domain is not verified' } }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'failed');
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].error!, /domain is not verified/);
});

test('a thrown network error is caught, logged failed, error name only', async () => {
  const { store, rows } = logStore();
  const r = await sendEmail('payment_rejected', 'u@example.test', { plan: 'pro', reason: 'x', supportEmail: null, plansUrl: 'https://a.test/plans' }, {}, {
    config: cfg, log: store, send: async () => { throw new TypeError('fetch failed: secret-token-123'); },
  });
  assert.equal(r.ok, false);
  assert.equal(rows[0].status, 'failed');
  assert.ok(!String(rows[0].error).includes('secret-token-123'));
});

test('unknown template is refused without sending or logging', async () => {
  const { store, rows } = logStore();
  let called = false;
  const r = await sendEmail('welcome' as never, 'a@example.test', {} as never, {}, {
    config: cfg, log: store, send: async () => { called = true; return { error: null }; },
  });
  assert.equal(r.ok, false);
  assert.equal(called, false);
  assert.equal(rows.length, 0);
});

test('missing configuration is a logged failure, not a throw', async () => {
  const { store, rows } = logStore();
  const r = await sendEmail('payment_approved', 'u@example.test', { plan: 'pro', expiresOn: 'x' }, {}, {
    config: () => ({ resendApiKey: null, emailFrom: null }), log: store,
  });
  assert.equal(r.ok, false);
  assert.equal(rows[0].error, 'email not configured');
});

test('a failing email_log does not stop the send', async () => {
  let sent = false;
  const store: EmailLogStore = { async start() { throw new Error('db'); }, async finish() { throw new Error('db'); } };
  const r = await sendEmail('payment_approved', 'u@example.test', { plan: 'pro', expiresOn: 'x' }, {}, {
    config: cfg, log: store, send: async () => { sent = true; return { error: null }; },
  });
  assert.equal(r.ok, true);
  assert.equal(sent, true);
});

test('a duplicate reminder claim is not sent', async () => {
  const store: EmailLogStore = { async start() { return null; }, async finish() {} };
  let sent = false;
  const r = await sendEmail('expiry_reminder', 'u@example.test', { plan: 'pro', expiresOn: 'x', plansUrl: 'https://a.test' }, { subjectId: 'p1' }, {
    config: cfg, log: store, send: async () => { sent = true; return { error: null }; },
  });
  assert.equal(r.ok, false);
  assert.equal(sent, false);
});

test('templates escape user-controlled values in HTML and keep them in text', () => {
  const r = renderEmail({ template: 'payment_rejected', plan: 'pro', reason: '<script>alert(1)</script> "x"', supportEmail: 's@example.test', plansUrl: 'https://a.test/plans?a=1&b=2' });
  assert.ok(!r.html.includes('<script>'));
  assert.ok(r.html.includes('&lt;script&gt;'));
  assert.ok(r.text.includes('<script>alert(1)</script>'));
  assert.ok(r.html.includes('a=1&amp;b=2'));
  assert.equal(esc(`a&b<"'`), 'a&amp;b&lt;&quot;&#39;');
});

test('approved and reminder copy carry plan and date; no exclamation marks', () => {
  const a = renderEmail({ template: 'payment_approved', plan: 'pro', expiresOn: '11 Dec 2026' });
  assert.equal(a.subject, 'Your Pro plan is active');
  assert.match(a.text, /active until 11 Dec 2026/);
  const rem = renderEmail({ template: 'expiry_reminder', plan: 'plus', expiresOn: '14 Nov 2026', plansUrl: 'https://a.test/plans' });
  for (const t of [a.text, rem.text, rem.subject]) assert.ok(!t.includes('!'));
});

test('admin notification: one email and one log row per ADMIN_EMAILS address, with user, plan, amount, link', async () => {
  const { store, rows } = logStore();
  const sent: Array<{ to: string; text: string }> = [];
  const res = await notifyAdminsPaymentSubmitted(
    { requestId: 'req9', userEmail: 'farid@example.test', plan: 'pro', amountUsd: 12 },
    { adminEmails: ['a@example.test', 'b@example.test'], siteUrl: 'https://app.example.test', config: cfg, log: store,
      send: async (m) => { sent.push({ to: m.to, text: m.text }); return { error: null }; } },
  );
  assert.equal(res.length, 2);
  assert.deepEqual(sent.map((s) => s.to).sort(), ['a@example.test', 'b@example.test']);
  assert.match(sent[0].text, /farid@example\.test/);
  assert.match(sent[0].text, /\$12\.00 USD/);
  assert.match(sent[0].text, /https:\/\/app\.example\.test\/admin/);
  assert.deepEqual(rows.map((r) => r.subjectId), ['req9', 'req9']);
});

test('admin notification with no admins sends nothing and does not throw', async () => {
  assert.deepEqual(await notifyAdminsPaymentSubmitted({ requestId: 'r', userEmail: null, plan: 'pro', amountUsd: 12 }, { adminEmails: [] }), []);
});

test('static: the log store re-claims only a FAILED reminder, atomically, and never other templates', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(`${__dirname}/email.ts`, 'utf8');
  assert.match(src, /row\.template !== 'expiry_reminder'/);
  assert.match(src, /\.eq\('status', 'failed'\)/);
});
