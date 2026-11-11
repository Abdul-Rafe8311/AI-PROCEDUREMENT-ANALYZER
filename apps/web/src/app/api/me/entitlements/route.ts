// guard: jwt
import { requirePrincipal } from '@/lib/server/guard';
import { buildEntitlements } from '@/lib/server/me-entitlements';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requirePrincipal(req);
  if (!g.ok) return g.response;
  return buildEntitlements(g.principal);
}
