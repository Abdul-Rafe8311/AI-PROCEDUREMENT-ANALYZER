// guard: jwt
import { requirePrincipal } from '@/lib/server/guard';
import { buildBillingConfig } from '@/lib/server/billing-config';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requirePrincipal(req);
  if (!g.ok) return g.response;
  return buildBillingConfig();
}
