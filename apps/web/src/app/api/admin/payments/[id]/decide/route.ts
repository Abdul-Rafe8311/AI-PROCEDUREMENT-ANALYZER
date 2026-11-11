// guard: admin
import { requireAdmin } from '@/lib/server/guard';
import { decidePayment } from '@/lib/server/payments-admin';
import { supabaseAdminPaymentsStore } from '@/lib/server/payments-admin-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  try {
    return await decidePayment(req, id, g.principal, { store: supabaseAdminPaymentsStore() });
  } catch {
    return Response.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
