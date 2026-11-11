// Response builders for /api/admin/api-keys, with injectable deps for tests (AD-2).
import { NextResponse } from 'next/server';
import { userExists } from './db';
import { auditApiKey, generateApiKey, hashApiKey, insertApiKey, revokeApiKeyById } from './api-keys';
import type { Principal } from './guard';

export interface AdminApiKeysDeps {
  userExists?: (userId: string) => Promise<boolean>;
  insertKey?: (args: { userId: string; sha256: string; label: string | null }) => Promise<string>;
  revokeKey?: (id: string) => Promise<boolean>;
  audit?: (args: Parameters<typeof auditApiKey>[0]) => Promise<void>;
  generate?: () => string;
}

const headers = { 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unavailable = () =>
  NextResponse.json({ error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' }, { status: 503, headers });
const validation = (fields: Record<string, string>) =>
  NextResponse.json({ error: 'Invalid input.', code: 'VALIDATION', fields }, { status: 400, headers });

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** POST: create a key for a user. The raw key is returned once and never stored or logged. */
export async function buildApiKeyCreate(req: Request, principal: Principal, deps: AdminApiKeysDeps = {}) {
  const b = await readBody(req);
  const fields: Record<string, string> = {};
  if (typeof b.userId !== 'string' || !UUID.test(b.userId)) fields.userId = 'A valid user id is required.';
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 80) || null : null;
  if (b.label != null && typeof b.label !== 'string') fields.label = 'Label must be text.';
  if (Object.keys(fields).length) return validation(fields);
  const userId = b.userId as string;
  try {
    if (!(await (deps.userExists ?? userExists)(userId))) {
      return NextResponse.json({ error: 'User not found.', code: 'NOT_FOUND' }, { status: 404, headers });
    }
    const raw = (deps.generate ?? generateApiKey)();
    const id = await (deps.insertKey ?? insertApiKey)({ userId, sha256: hashApiKey(raw), label });
    await (deps.audit ?? auditApiKey)({ action: 'api_key_create', adminEmail: principal.email, userId, keyId: id });
    return NextResponse.json({ id, userId, label, key: raw }, { status: 201, headers });
  } catch (err) {
    console.error('[admin-api-keys] create failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}

/** DELETE: revoke a key by id (sets revoked_at). */
export async function buildApiKeyRevoke(req: Request, principal: Principal, deps: AdminApiKeysDeps = {}) {
  const b = await readBody(req);
  if (typeof b.id !== 'string' || !UUID.test(b.id)) return validation({ id: 'A valid key id is required.' });
  try {
    const revoked = await (deps.revokeKey ?? revokeApiKeyById)(b.id);
    if (!revoked) return NextResponse.json({ error: 'Key not found.', code: 'NOT_FOUND' }, { status: 404, headers });
    await (deps.audit ?? auditApiKey)({ action: 'api_key_revoke', adminEmail: principal.email, userId: null, keyId: b.id });
    return NextResponse.json({ id: b.id, revoked: true }, { headers });
  } catch (err) {
    console.error('[admin-api-keys] revoke failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}
