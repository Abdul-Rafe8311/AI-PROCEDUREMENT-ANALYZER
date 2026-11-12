import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

// Client page, so its metadata lives here. Public and indexable (unlike the rest of the (auth) group).
export const metadata: Metadata = pageMetadata({
  title: 'Sign in · AI Procurement Copilot',
  description:
    'Sign in to AI Procurement Copilot to compare supplier quotations, review RFQ bid scoring and export technical approval (TA) forms.',
  path: '/login',
});

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
