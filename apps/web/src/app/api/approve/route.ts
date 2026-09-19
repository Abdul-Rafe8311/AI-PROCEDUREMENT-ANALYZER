import { NextResponse } from 'next/server';

// GET /api/approve?token=<prMessageId>
// The landing page behind the "Approve" link in the analysis email. A human
// clicking it is the gate before any supplier actually gets told they won or
// lost — the Fastn workflow that generated the analysis stores the pending
// decision (fastn.state) instead of acting on it, and only this click fires
// procurement-approval-confirm, which reads that state and sends the
// notifications. The webhook dispatches async (202, fire-and-forget), so this
// page reports "submitted", not a guaranteed final outcome.

export const runtime = 'nodejs';

const APPROVAL_WEBHOOK_URL =
  'https://webhooks.fastn.dev/prod/triggers/personal_3304ddac7c6e03642302/webhooks/b9739206-fd86-4aa2-afc9-b5745237183d';

function page(title: string, message: string, ok: boolean) {
  return new NextResponse(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 0; }
    .wrap { max-width: 480px; margin: 12vh auto 0; text-align: center; padding: 0 24px; }
    .badge { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #64748b; font-size: 14.5px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="badge">${ok ? '✅' : '⚠️'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return page('Missing approval link', 'This link is missing its approval token — please use the link from the analysis email directly.', false);
  }

  try {
    const res = await fetch(APPROVAL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      return page('Could not process approval', 'Something went wrong reaching the approval service. Please try again in a moment.', false);
    }
    return page(
      'Approved',
      'Supplier notifications are being sent now — the winning supplier gets an acceptance, the rest get a polite decline. This link is single-use; if you already clicked it once, nothing further will happen.',
      true,
    );
  } catch (err) {
    return page('Could not reach the approval service', (err as Error).message, false);
  }
}
