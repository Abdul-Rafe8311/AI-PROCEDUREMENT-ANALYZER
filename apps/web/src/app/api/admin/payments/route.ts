// guard: admin
import { requireAdmin } from '@/lib/server/guard';
import { listAdminPayments } from '@/lib/server/payments-admin';
import { supabaseAdminPaymentsStore } from '@/lib/server/payments-admin-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.response;
  try {
    return await listAdminPayments(req, supabaseAdminPaymentsStore());
  } catch {
    return Response.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
