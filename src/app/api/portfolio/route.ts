import { NextRequest, NextResponse } from 'next/server';
import { getAggregateValue, getPortfolioValue, getHoldings, getDailyPnL, getAllTimePnL, getTotalDeposited } from '@/lib/services/portfolio';
import { maybeCheckSplits } from '@/lib/services/splits';

export async function GET(request: NextRequest) {
  const account = request.nextUrl.searchParams.get('account') || 'all';

  // Throttled background split sweep — catches a split intraday instead of
  // showing a fake crash until the evening cron. Never blocks the response.
  maybeCheckSplits();

  try {
    if (account === 'all') {
      const aggregate = await getAggregateValue();
      const holdings = await getHoldings();
      const [pnl, allTimePnl, totalDeposited] = await Promise.all([getDailyPnL(), getAllTimePnL(), getTotalDeposited()]);
      return NextResponse.json({
        data: {
          ...aggregate,
          holdings,
          pnl,
          all_time_pnl: allTimePnl,
          total_deposited: totalDeposited,
        },
      });
    }

    // Per-account view
    const [portfolioValue, holdings, pnl, allTimePnl, totalDeposited] = await Promise.all([
      getPortfolioValue(account),
      getHoldings(account),
      getDailyPnL(account),
      getAllTimePnL(account),
      getTotalDeposited(account),
    ]);

    return NextResponse.json({
      data: {
        account_id: account,
        ...portfolioValue,
        holdings,
        pnl,
        all_time_pnl: allTimePnl,
        total_deposited: totalDeposited,
      },
    });
  } catch (err) {
    console.error('[API/portfolio] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
