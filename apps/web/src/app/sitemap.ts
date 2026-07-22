import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Public pages only. The workspace and the auth screens are deliberately absent —
// they are gated (or account-only) and are disallowed in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [{ url: `${SITE_URL}/`, lastModified, changeFrequency: 'monthly', priority: 1 }];
}
