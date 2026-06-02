import { NextRequest, NextResponse } from 'next/server';
import { collectDailySummaries } from '@/lib/services/collect-summaries';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Invalid or missing x-cron-secret header' },
      { status: 401 }
    );
  }

  try {
    const result = await collectDailySummaries();
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[Cron/daily-summaries] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
