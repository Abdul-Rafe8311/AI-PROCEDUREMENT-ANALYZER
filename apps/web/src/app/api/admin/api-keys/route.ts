// guard: admin
import { requireAdmin } from '@/lib/server/guard';
import { buildApiKeyCreate, buildApiKeyRevoke } from '@/lib/server/admin-api-keys';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.response;
  return buildApiKeyCreate(req, g.principal);
}

export async function DELETE(req: Request) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.response;
  return buildApiKeyRevoke(req, g.principal);
}
