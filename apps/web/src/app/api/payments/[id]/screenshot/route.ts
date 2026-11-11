// guard: jwt
import { isAdminPrincipal, requirePrincipal } from '@/lib/server/guard';
import { getConfig } from '@/lib/server/config';
import { screenshotUrl } from '@/lib/server/payments';
import { supabasePaymentsStore } from '@/lib/server/payments-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePrincipal(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  try {
    return await screenshotUrl(g.principal, id, isAdminPrincipal(g.principal, getConfig()), supabasePaymentsStore());
  } catch {
    return Response.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
