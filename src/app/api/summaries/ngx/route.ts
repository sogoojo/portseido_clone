import { NextResponse } from 'next/server';
import { getNgxSummaries } from '@/lib/services/ngx-summaries';

// A first (cold) call may pull candle history from TradingView for uncached
// names; warm calls are fast cache reads. Allow headroom either way.
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await getNgxSummaries();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[API/summaries/ngx] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
