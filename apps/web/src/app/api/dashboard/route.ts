import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET  /api/dashboard?token=<prMessageId>  — serves the stored dashboard page.
// POST /api/dashboard { token, html }      — called by the Fastn workflow to
//                                             store it (a plain synchronous
//                                             fetch, same pattern as /api/extract
//                                             and /api/report/export).
//
// The dashboard used to be a raw .html email attachment; it's a real page now
// so the email can just link to it. Fastn's inbound webhooks always dispatch
// async (202, fire-and-forget — see /api/approve), so there's no way to read
// fastn.state back synchronously from a page load; Supabase is the durable
// store instead, written directly by the workflow's own fetch call.

export const runtime = 'nodejs';

function errorPage(title: string, message: string) {
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
    <div class="badge">⚠️</div>
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
    return errorPage('Missing dashboard link', 'This link is missing its token — please use the link from the analysis email directly.');
  }
  if (!supabase) {
    return errorPage('Dashboard storage not configured', 'Supabase is not configured on this deployment.');
  }

  const { data, error } = await supabase.from('dashboards').select('html').eq('token', token).maybeSingle();
  if (error || !data) {
    return errorPage('Dashboard not found', "This link couldn't be loaded. Check the analysis email for the current link.");
  }
  return new NextResponse(data.html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(req: Request) {
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  let body: { token?: string; html?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { token, html } = body;
  if (!token || !html) {
    return NextResponse.json({ error: 'token and html are required' }, { status: 400 });
  }

  const { error } = await supabase.from('dashboards').upsert({ token, html }, { onConflict: 'token' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
