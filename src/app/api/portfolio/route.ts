import { NextRequest, NextResponse } from 'next/server';
import { getAggregateValue, getPortfolioValue, getHoldings, getDailyPnL, getAllTimePnL, getTotalDeposited } from '@/lib/services/portfolio';

export async function GET(request: NextRequest) {
  const account = request.nextUrl.searchParams.get('account') || 'all';

  try {
    if (account === 'all') {
      const aggregate = await getAggregateValue();
      const holdings = await getHoldings();
      const [pnl, allTimePnl] = await Promise.all([getDailyPnL(), getAllTimePnL()]);
      const totalDeposited = getTotalDeposited();
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
    const [portfolioValue, holdings, pnl, allTimePnl] = await Promise.all([
      getPortfolioValue(account),
      getHoldings(account),
      getDailyPnL(account),
      getAllTimePnL(account),
    ]);
    const totalDeposited = getTotalDeposited(account);

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
