import { ImageResponse } from 'next/og';

// Apple touch icon (home-screen / bookmark) — larger, more padding.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const SPARKLE =
  'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#4f46e5',
        }}
      >
        <svg width="112" height="112" viewBox="0 0 24 24" fill="#ffffff">
          <path d={SPARKLE} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
