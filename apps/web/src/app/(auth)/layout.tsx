import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';

// Account screens are client components, so the group layout carries their
// metadata. They are account-only, not marketing pages — keep them unindexed
// (mirrors the robots.txt disallow; public pages stay indexable).
export const metadata: Metadata = {
  // Neutral title: this layout covers sign-in, sign-up and password reset.
  title: 'Account',
  description:
    'Sign in or create an AI Procurement Copilot account to access your saved analyses.',
  robots: { index: false, follow: false },
};

// Shared chrome for the sign-in / sign-up / password-reset screens: split brand panel on desktop,
// form only on mobile. Individual pages render their own title + form.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
