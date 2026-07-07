// Reuse the OpenGraph image for the Twitter/X summary_large_image card.
export { default, size, contentType } from './opengraph-image';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
