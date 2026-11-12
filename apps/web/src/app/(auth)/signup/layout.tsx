import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

// Client page, so its metadata lives here. Public and indexable (unlike the rest of the (auth) group).
export const metadata: Metadata = pageMetadata({
  title: 'Create a free account · AI Procurement Copilot',
  description:
    'Create a free AI Procurement Copilot account and start comparing supplier quotations, scoring bids and generating technical approval (TA) forms.',
  path: '/signup',
});

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
