// guard: admin
import { requireAdmin } from '@/lib/server/guard';
import { buildAdminUsersGet, buildAdminUsersPost } from '@/lib/server/admin-users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.response;
  return buildAdminUsersGet(req);
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.response;
  return buildAdminUsersPost(req, g.principal);
}
