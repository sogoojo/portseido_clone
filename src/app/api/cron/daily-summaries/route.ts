import { NextRequest, NextResponse } from 'next/server';
import { runDailySummaries } from '@/lib/services/summaries';

export const maxDuration = 120;

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
    // Optional ?date=YYYY-MM-DD backfills that past day from historical bars.
    const dateParam = request.nextUrl.searchParams.get('date');
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: 'bad_request', message: 'date must be YYYY-MM-DD' },
        { status: 400 }
      );
    }
    const result = await runDailySummaries(dateParam || undefined);
    // Zero successes with tickers to process means the whole run failed
    // (Yahoo down, or a delayed cron tripping the freshness guard on every
    // ticker) — return 5xx so the GitHub Action goes red instead of silently
    // leaving a missing day
    if (result.total > 0 && result.success === 0) {
      return NextResponse.json(
        { error: 'empty_run', message: `0/${result.total} tickers summarised for ${result.date}`, data: result },
        { status: 502 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[Cron/daily-summaries] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
