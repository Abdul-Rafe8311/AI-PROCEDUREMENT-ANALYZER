import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

// Social share image (LinkedIn / WhatsApp / Slack / X). Auto-attached by Next to
// every route's OpenGraph + Twitter tags. Built from brand colors, no webfont.
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SPARKLE =
  'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#ffffff',
          backgroundImage: 'radial-gradient(1000px 500px at 100% 0%, #eef2ff 0%, #ffffff 55%)',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: '#4f46e5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="42" height="42" viewBox="0 0 24 24" fill="#ffffff">
              <path d={SPARKLE} />
            </svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: '#334155' }}>{SITE_NAME}</div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, color: '#0f172a', lineHeight: 1.05, letterSpacing: -1 }}>
            Compare supplier quotations automatically
          </div>
          <div style={{ fontSize: 32, color: '#475569', maxWidth: 940, lineHeight: 1.3 }}>
            Upload quotes → side-by-side comparison, risk flags, and a recommendation you can defend.
          </div>
        </div>

        {/* Honest feature chips */}
        <div style={{ display: 'flex', gap: 14 }}>
          {['Automatic comparison', 'Risk detection', 'Downloadable reports'].map((t) => (
            <div
              key={t}
              style={{
                display: 'flex',
                fontSize: 24,
                fontWeight: 600,
                color: '#4338ca',
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                borderRadius: 999,
                padding: '10px 22px',
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
