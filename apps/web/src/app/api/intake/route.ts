import { NextResponse } from 'next/server';

// POST /api/intake
// Cross-origin proxy in front of the Fastn webhook trigger, for the intake
// upload page (a claude.ai artifact — a different origin, and possibly a
// different demo host later). Two CORS problems, not one: Fastn's webhook
// endpoint sends no Access-Control-Allow-Origin, so a browser can't call it
// directly at all; and this route needs its OWN CORS headers (including an
// explicit OPTIONS handler, since a JSON POST body is not a CORS-simple
// request) or the artifact can't call THIS route either. Node's server-side
// fetch has no CORS restriction, so the actual forward just works.

export const runtime = 'nodejs';
export const maxDuration = 30;

const FASTN_WEBHOOK_URL =
  'https://webhooks.fastn.dev/prod/triggers/personal_3304ddac7c6e03642302/webhooks/3f2f8e5b-1ab1-4485-853a-6f24336a9b07';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not read the request body.', detail: (err as Error).message },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const res = await fetch(FASTN_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not reach the Fastn webhook.', detail: (err as Error).message },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
