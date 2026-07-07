import type { Metadata } from 'next';

// Server layout so the client workspace page can still carry its own metadata
// (title, description, canonical). It only passes children through.
export const metadata: Metadata = {
  title: 'Workspace',
  description:
    'Upload supplier quotations (and your purchase requisition) to get an automatic comparison, technical-approval matching, risk flags, and a recommendation — no account required.',
  alternates: { canonical: '/workspace' },
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
