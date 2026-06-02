import { NextRequest, NextResponse } from 'next/server';
import { getPortfolioReturns, getBenchmarkReturns, getHistoricalReturns } from '@/lib/services/returns';

export async function GET(request: NextRequest) {
  const account = request.nextUrl.searchParams.get('account') || 'all';
  const granularity = (request.nextUrl.searchParams.get('granularity') || 'monthly') as 'monthly' | 'quarterly' | 'annually';

  try {
    const [portfolio, sp500, nasdaq, historical] = await Promise.all([
      getPortfolioReturns(account === 'all' ? undefined : account),
      getBenchmarkReturns('^GSPC'),
      getBenchmarkReturns('^IXIC'),
      getHistoricalReturns(account === 'all' ? undefined : account, granularity),
    ]);

    return NextResponse.json({
      data: {
        portfolio,
        benchmarks: { sp500, nasdaq },
        historical,
      },
    });
  } catch (err) {
    console.error('[API/performance] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
