import type { Metadata } from 'next';
import { RequireAuth } from '@/components/auth/require-auth';

export const metadata: Metadata = {
  title: 'Plans',
  robots: { index: false, follow: false },
};

export default function PlansLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
