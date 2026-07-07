import { NextRequest, NextResponse } from 'next/server';
import { runDailySummaries } from '@/lib/services/summaries';
import { refreshRotationUniverse } from '@/lib/services/rotation';
import { getNgxSummaries } from '@/lib/services/ngx-summaries';
import { checkAndApplySplits, type SplitCheckResult } from '@/lib/services/splits';

// Summaries + the Radar universe's end-of-day price pull share this run; the
// first invocation also backfills history, so allow extra headroom.
export const maxDuration = 300;

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
    // Restate any fresh stock splits BEFORE summarising, so today's summary
    // rows land in post-split terms. Best-effort: a Yahoo hiccup here must not
    // block the summaries run. Skipped on historical (?date=) backfills.
    let splits: SplitCheckResult | { error: string } | null = null;
    if (!dateParam) {
      try {
        splits = await checkAndApplySplits();
      } catch (err) {
        splits = { error: (err as Error).message };
        console.error('[Cron/daily-summaries] Split check failed:', err);
      }
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

    // Append today's end-of-day bars for the Radar universe (sector/theme ETFs,
    // baskets, holdings). Best-effort: a failure here must not fail the summaries
    // run. Skipped on historical (?date=) backfills.
    let rotation: { universe: number; refreshed: number } | { error: string } | null = null;
    if (!dateParam) {
      try {
        rotation = await refreshRotationUniverse();
      } catch (err) {
        rotation = { error: (err as Error).message };
        console.error('[Cron/daily-summaries] Rotation refresh failed:', err);
      }
    }

    // Warm NGX price + momentum for the summaries page (held + watchlist names).
    // Candle history caches permanently, so this one-time-per-name backfill keeps
    // the page's first real visit fast. Best-effort; skipped on backfills.
    let ngx: { count: number } | { error: string } | null = null;
    if (!dateParam) {
      try {
        ngx = { count: (await getNgxSummaries()).length };
      } catch (err) {
        ngx = { error: (err as Error).message };
        console.error('[Cron/daily-summaries] NGX warm failed:', err);
      }
    }

    return NextResponse.json({ data: { ...result, rotation, ngx, splits } });
  } catch (err) {
    console.error('[Cron/daily-summaries] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
