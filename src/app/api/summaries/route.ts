import { NextRequest, NextResponse } from 'next/server';
import { getSummaries, getSummaryForDate, getLatestSummaries } from '@/lib/services/summaries';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const ticker = params.get('ticker');
    const from = params.get('from');
    const to = params.get('to');
    const latest = params.get('latest');
    // High cap: trend views need a full window of (tickers × days) rows —
    // capping at 200 silently truncated 3M/1Y trends to a few days of data
    const limitRaw = parseInt(params.get('limit') || '50', 10);
    const limit = Math.max(1, Math.min(20000, Number.isFinite(limitRaw) ? limitRaw : 50));
    const pageRaw = parseInt(params.get('page') || '1', 10);
    const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);

    if (ticker && from && !to && latest !== 'true') {
      const summary = getSummaryForDate(ticker, from);
      if (!summary) {
        return NextResponse.json(
          { error: 'not_found', message: `No summary for ${ticker} on ${from}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ data: summary });
    }

    if (latest === 'true') {
      const tickers = ticker ? ticker.split(',').map(t => t.trim()) : undefined;
      const summaries = getLatestSummaries(tickers);
      return NextResponse.json({ data: summaries });
    }

    const result = getSummaries({
      ticker: ticker || undefined,
      from: from || undefined,
      to: to || undefined,
      limit,
      offset: (page - 1) * limit,
    });
    return NextResponse.json({
      data: result.summaries,
      total: result.total,
      page,
      limit,
    });
  } catch (err) {
    console.error('[API/summaries] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
