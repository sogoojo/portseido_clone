import { NextRequest, NextResponse } from 'next/server';
import { getPortfolioReturns, getBenchmarkReturns, getHistoricalReturns, getCurrentPortfolioValueUsd } from '@/lib/services/returns';
import { buildValuationContext } from '@/lib/services/history';
import { ServerTiming } from '@/lib/server-timing';

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const account = request.nextUrl.searchParams.get('account') || 'all';
  const granularity = (request.nextUrl.searchParams.get('granularity') || 'monthly') as 'monthly' | 'quarterly' | 'annually';
  const view = request.nextUrl.searchParams.get('view');
  const accountId = account === 'all' ? undefined : account;

  try {
    const [currentValue, context] = await Promise.all([
      timing.measure('current', () => getCurrentPortfolioValueUsd(accountId), 'Current prices and FX'),
      timing.measure('history', () => buildValuationContext(accountId, new Date()), 'Historical valuation context'),
    ]);
    const portfolio = await timing.measure(
      'returns',
      () => getPortfolioReturns(accountId, { currentValue, context }),
      'Portfolio period returns'
    );

    // Dashboard gains only consume portfolio returns. Avoid calculating two
    // benchmarks and the historical chart until the full Performance page asks.
    if (view === 'portfolio') {
      const response = NextResponse.json({ data: { portfolio } });
      response.headers.set('Server-Timing', timing.header());
      return response;
    }

    const [sp500, nasdaq, historical] = await timing.measure(
      'extras',
      () => Promise.all([
        getBenchmarkReturns('^GSPC'),
        getBenchmarkReturns('^IXIC'),
        getHistoricalReturns(accountId, granularity, context),
      ]),
      'Benchmarks and historical returns'
    );

    const response = NextResponse.json({
      data: {
        portfolio,
        benchmarks: { sp500, nasdaq },
        historical,
      },
    });
    response.headers.set('Server-Timing', timing.header());
    return response;
  } catch (err) {
    console.error('[API/performance] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
