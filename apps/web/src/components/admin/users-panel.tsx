'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-fetch';
import { useAuth } from '@/lib/auth-context';
import { planLabel } from '@/lib/admin-override';
import { OverrideForm, type OverrideResult } from './override-dialog';

interface LastChange {
  adminEmail: string | null;
  at: string;
}

interface UserRow {
  id: string;
  email: string | null;
  plan: string;
  expiresAt: string | null;
  lastChange: LastChange | null;
}

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function UsersPanel() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (q: string) => {
    const id = ++reqId.current;
    try {
      const res = await apiFetch(`/api/admin/users?search=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('bad status');
      const body = await res.json();
      if (id !== reqId.current) return;
      setRows(body.users as UserRow[]);
      setError(false);
    } catch {
      if (id !== reqId.current) return;
      setError(true);
      toast.error('Could not load users. Please try again.');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  function applied(userId: string, r: OverrideResult) {
    setRows((prev) =>
      (prev ?? []).map((u) =>
        u.id === userId
          ? {
              ...u,
              plan: r.plan,
              expiresAt: r.endsAt,
              lastChange: { adminEmail: user?.email ?? null, at: new Date().toISOString() },
            }
          : u,
      ),
    );
    setEditing(null);
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Users</h2>
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email"
        aria-label="Search users by email"
        className="mt-3 h-11"
      />
      {error && rows === null && (
        <p className="mt-4 text-sm text-muted-foreground">
          Could not load users.{' '}
          <button className="underline" onClick={() => void load(search)}>
            Retry
          </button>
        </p>
      )}
      {rows !== null && rows.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No users match.</p>}
      <ul className="mt-4 divide-y divide-border/70">
        {(rows ?? []).map((u) => (
          <li key={u.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium">{u.email ?? u.id}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant={u.plan === 'free' ? 'secondary' : 'default'}>{planLabel(u.plan)}</Badge>
                  <span>{u.expiresAt ? `Expires ${dateOnly(u.expiresAt)}` : 'No expiry'}</span>
                </p>
              </div>
              <Button
                variant="outline"
                className="h-11 min-w-[44px]"
                onClick={() => setEditing(editing === u.id ? null : u.id)}
              >
                Change plan
              </Button>
            </div>
            {u.lastChange && (
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {u.lastChange.adminEmail ?? 'Unknown admin'}, {dateTime(u.lastChange.at)}
              </p>
            )}
            {editing === u.id && (
              <OverrideForm
                userId={u.id}
                email={u.email}
                onDone={(r) => applied(u.id, r)}
                onCancel={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
