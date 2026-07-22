import type { Metadata } from 'next';
import { RequireAuth } from '@/components/auth/require-auth';

// Server layout so the client workspace page can still carry its own metadata
// (title, description, canonical). It wraps the workspace in the auth gate so
// only signed-in users reach it.
export const metadata: Metadata = {
  title: 'Workspace',
  description:
    'Upload supplier quotations (and your purchase requisition) to get an automatic comparison, technical-approval matching, risk flags, and a recommendation.',
  alternates: { canonical: '/workspace' },
  // Auth-gated: a crawler only ever sees the redirect gate, so keep it out of the
  // index (mirrors the robots.txt disallow — this does not affect public pages).
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
