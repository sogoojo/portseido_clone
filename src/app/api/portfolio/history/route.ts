import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getHistoricalPrices } from '@/lib/services/prices';
import { buildValuationContext } from '@/lib/services/history';

interface HistoryDataPoint {
  date: string;
  portfolio_value: number;
  sp500_normalized: number;
  deposits_cumulative: number;
}

function getDateRange(range: string): { from: Date; granularity: 'daily' | 'monthly' } {
  const now = new Date();
  let from: Date;
  let granularity: 'daily' | 'monthly' = 'monthly';

  switch (range) {
    case '1M':
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
      granularity = 'daily';
      break;
    case '3M':
      from = new Date(now);
      from.setMonth(from.getMonth() - 3);
      granularity = 'daily';
      break;
    case '6M':
      from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      granularity = 'monthly';
      break;
    case 'YTD':
      from = new Date(now.getFullYear(), 0, 1);
      granularity = 'monthly';
      break;
    case '1Y':
      from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      granularity = 'monthly';
      break;
    case '3Y':
      from = new Date(now);
      from.setFullYear(from.getFullYear() - 3);
      granularity = 'monthly';
      break;
    case '5Y':
      from = new Date(now);
      from.setFullYear(from.getFullYear() - 5);
      granularity = 'monthly';
      break;
    case 'All':
    default: {
      const first = db.prepare('SELECT MIN(date) as d FROM transactions').get() as { d: string | null };
      from = first.d ? new Date(first.d) : new Date(now.getFullYear() - 1, 0, 1);
      granularity = 'monthly';
      break;
    }
  }

  return { from, granularity };
}

function generateDatePoints(from: Date, to: Date, granularity: 'daily' | 'monthly'): string[] {
  const dates: string[] = [];
  const current = new Date(from);

  if (granularity === 'daily') {
    while (current <= to) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
  } else {
    // Monthly: first of each month + today
    current.setDate(1);
    while (current <= to) {
      dates.push(current.toISOString().split('T')[0]);
      current.setMonth(current.getMonth() + 1);
    }
    const todayStr = to.toISOString().split('T')[0];
    if (dates[dates.length - 1] !== todayStr) {
      dates.push(todayStr);
    }
  }

  return dates;
}

export async function GET(request: NextRequest) {
  const accountParam = request.nextUrl.searchParams.get('account') || 'all';
  const range = request.nextUrl.searchParams.get('range') || '1Y';

  try {
    const { from, granularity } = getDateRange(range);
    const to = new Date();
    const datePoints = generateDatePoints(from, to, granularity);

    if (datePoints.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Valuation context handles FIFO replay, historical prices, FX-to-USD
    // conversion and track_cash — all values below are USD
    const ctx = await buildValuationContext(
      accountParam !== 'all' ? accountParam : undefined,
      to
    );

    // SPY for the benchmark overlay. Monthly date points snap to the 1st of
    // the month, which can precede `from` — fetch from before the first
    // point (plus weekend lookback) so the first normalisation has a price.
    const spyFrom = new Date(datePoints[0]);
    spyFrom.setDate(spyFrom.getDate() - 7);
    const spyRows = await getHistoricalPrices('SPY', spyFrom, to);
    const spyMap = new Map(spyRows.map(r => [r.date, r.close]));
    function getSpyPrice(dateStr: string): number {
      if (spyMap.has(dateStr)) return spyMap.get(dateStr)!;
      const d = new Date(dateStr);
      for (let i = 1; i <= 5; i++) {
        d.setDate(d.getDate() - 1);
        const key = d.toISOString().split('T')[0];
        if (spyMap.has(key)) return spyMap.get(key)!;
      }
      return 0;
    }

    const dataPoints: HistoryDataPoint[] = [];
    const firstSpyPrice = getSpyPrice(datePoints[0]);

    for (const dateStr of datePoints) {
      const v = ctx.valueAt(dateStr);

      const spyPrice = getSpyPrice(dateStr);
      const sp500Normalized = firstSpyPrice > 0 && dataPoints.length === 0
        ? v.total // first point matches portfolio
        : firstSpyPrice > 0
          ? (spyPrice / firstSpyPrice) * (dataPoints[0]?.portfolio_value || v.total)
          : 0;

      dataPoints.push({
        date: dateStr,
        portfolio_value: Math.round(v.total * 100) / 100,
        sp500_normalized: Math.round(sp500Normalized * 100) / 100,
        deposits_cumulative: Math.round(v.net_deposits * 100) / 100,
      });
    }

    return NextResponse.json({ data: dataPoints, currency: 'USD' });
  } catch (err) {
    console.error('[API/portfolio/history] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
