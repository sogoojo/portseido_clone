import { NextRequest, NextResponse } from 'next/server';
import { getAggregateValue, getPortfolioValue, getHoldings, getDailyPnL, getAllTimePnL, getTotalDeposited } from '@/lib/services/portfolio';
import { maybeCheckSplits } from '@/lib/services/splits';
import { ServerTiming } from '@/lib/server-timing';

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const account = request.nextUrl.searchParams.get('account') || 'all';

  // Throttled background split sweep — catches a split intraday instead of
  // showing a fake crash until the evening cron. Never blocks the response.
  maybeCheckSplits();

  try {
    if (account === 'all') {
      // Compute each holdings view once. Aggregate holdings intentionally omit
      // NGX; its isolated snapshot is only used for the NGX account card.
      const [holdings, isolatedHoldings] = await timing.measure(
        'holdings',
        () => Promise.all([getHoldings(), getHoldings('ngx')]),
        'FIFO plus current prices and FX'
      );
      const [aggregate, pnl, allTimePnl, totalDeposited] = await timing.measure(
        'metrics',
        () => Promise.all([
          getAggregateValue(holdings, isolatedHoldings),
          getDailyPnL(undefined, holdings),
          getAllTimePnL(undefined, holdings),
          getTotalDeposited(),
        ]),
        'Totals and PnL from holdings snapshot'
      );
      const response = NextResponse.json({
        data: {
          ...aggregate,
          holdings,
          pnl,
          all_time_pnl: allTimePnl,
          total_deposited: totalDeposited,
        },
      });
      response.headers.set('Server-Timing', timing.header());
      return response;
    }

    // Per-account view
    const holdings = await timing.measure('holdings', () => getHoldings(account), 'FIFO plus current prices and FX');
    const [portfolioValue, pnl, allTimePnl, totalDeposited] = await timing.measure(
      'metrics',
      () => Promise.all([
        getPortfolioValue(account, holdings),
        getDailyPnL(account, holdings),
        getAllTimePnL(account, holdings),
        getTotalDeposited(account),
      ]),
      'Totals and PnL from holdings snapshot'
    );

    const response = NextResponse.json({
      data: {
        account_id: account,
        ...portfolioValue,
        holdings,
        pnl,
        all_time_pnl: allTimePnl,
        total_deposited: totalDeposited,
      },
    });
    response.headers.set('Server-Timing', timing.header());
    return response;
  } catch (err) {
    console.error('[API/portfolio] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
