// guard: jwt
import { requirePrincipal } from '@/lib/server/guard';
import { getConfig } from '@/lib/server/config';
import { listOwnPayments, submitPayment } from '@/lib/server/payments';
import { supabasePaymentsStore } from '@/lib/server/payments-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const g = await requirePrincipal(req);
  if (!g.ok) return g.response;
  try {
    return await listOwnPayments(req, g.principal, supabasePaymentsStore());
  } catch {
    return Response.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const g = await requirePrincipal(req);
  if (!g.ok) return g.response;
  try {
    return await submitPayment(req, g.principal, {
      store: supabasePaymentsStore(),
      rawPrices: getConfig().planPricesUsd,
    });
  } catch {
    return Response.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
