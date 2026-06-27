import { NextResponse } from 'next/server';
import { computeRotation } from '@/lib/services/rotation';

// First call may fetch a year of history for the theme universe; subsequent
// calls are served from price_cache.
export const maxDuration = 120;

export async function GET() {
  try {
    const themes = await computeRotation();
    return NextResponse.json({ data: { themes, asOf: new Date().toISOString() } });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
