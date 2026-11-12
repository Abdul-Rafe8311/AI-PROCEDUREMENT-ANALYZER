import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

// Public pages only (the pricing section lives on the home page, so it has no URL of its own).
// Logged-in routes are noindex and disallowed in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: absoluteUrl('/'), lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/signup'), lastModified, changeFrequency: 'yearly', priority: 0.6 },
    { url: absoluteUrl('/login'), lastModified, changeFrequency: 'yearly', priority: 0.4 },
  ];
}
