import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#16a34a',
          color: 'white',
          display: 'flex',
          fontSize: 106,
          fontWeight: 700,
          height: '100%',
          justifyContent: 'center',
          letterSpacing: '-0.08em',
          width: '100%',
        }}
      >
        P
      </div>
    ),
    size
  );
}
