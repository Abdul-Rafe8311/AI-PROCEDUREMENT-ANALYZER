import { ImageResponse } from 'next/og';

// Generated favicon / tab icon — the brand sparkle mark on indigo.
export const size = { width: 48, height: 48 };
export const contentType = 'image/png';

const SPARKLE =
  'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z';

export default function Icon() {
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
          borderRadius: 11,
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="#ffffff">
          <path d={SPARKLE} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
