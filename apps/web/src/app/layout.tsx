import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Procurement Copilot — Compare Supplier Quotations in Minutes',
  description:
    'Upload quotations from multiple suppliers and let AI identify the best option based on price, delivery time, payment terms, and risk factors.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
