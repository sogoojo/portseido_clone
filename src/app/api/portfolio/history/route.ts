import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getHistoricalPrices } from '@/lib/services/prices';
import { convert } from '@/lib/services/fx';
import type { Transaction, Account } from '@/lib/types';

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

    // Get all relevant transactions up to today
    const accountCondition = accountParam !== 'all' ? 'AND t.account_id = ?' : '';
    const accountParams: string[] = accountParam !== 'all' ? [accountParam] : [];

    const allTransactions = db.prepare(
      `SELECT t.*, a.currency as account_currency
       FROM transactions t
       JOIN accounts a ON t.account_id = a.id
       WHERE 1=1 ${accountCondition}
       ORDER BY t.date`
    ).all(...accountParams) as (Transaction & { account_currency: string })[];

    // Collect unique tickers that were held
    const tickers = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.ticker && (tx.type === 'buy' || tx.type === 'sell')) {
        tickers.add(tx.ticker);
      }
    }

    // Fetch historical prices for all tickers + SPY
    const priceMap = new Map<string, Map<string, number>>(); // ticker -> (date -> close)

    const allTickers = [...tickers, 'SPY'];
    for (const ticker of allTickers) {
      const history = await getHistoricalPrices(ticker, from, to);
      const tickerMap = new Map<string, number>();
      for (const row of history) {
        tickerMap.set(row.date, row.close);
      }
      priceMap.set(ticker, tickerMap);
    }

    // Helper: find closest price on or before date
    function getPrice(ticker: string, dateStr: string): number {
      const tickerMap = priceMap.get(ticker);
      if (!tickerMap) return 0;
      if (tickerMap.has(dateStr)) return tickerMap.get(dateStr)!;
      // Look back up to 5 days
      const d = new Date(dateStr);
      for (let i = 1; i <= 5; i++) {
        d.setDate(d.getDate() - 1);
        const key = d.toISOString().split('T')[0];
        if (tickerMap.has(key)) return tickerMap.get(key)!;
      }
      return 0;
    }

    // Compute portfolio value at each date point
    const dataPoints: HistoryDataPoint[] = [];
    const firstSpyPrice = getPrice('SPY', datePoints[0]);

    for (const dateStr of datePoints) {
      // Replay transactions up to this date to get holdings
      const txsUpToDate = allTransactions.filter(tx => tx.date <= dateStr);

      // FIFO per ticker
      const holdingsMap = new Map<string, number>(); // ticker -> quantity
      const lots = new Map<string, { qty: number; price: number }[]>();

      for (const tx of txsUpToDate) {
        if (!tx.ticker) continue;
        if (tx.type === 'buy' && tx.quantity) {
          if (!lots.has(tx.ticker)) lots.set(tx.ticker, []);
          lots.get(tx.ticker)!.push({ qty: tx.quantity, price: tx.price_per_unit || 0 });
        } else if (tx.type === 'sell' && tx.quantity) {
          const tickerLots = lots.get(tx.ticker) || [];
          let toSell = tx.quantity;
          for (const lot of tickerLots) {
            if (toSell <= 0) break;
            const consume = Math.min(lot.qty, toSell);
            lot.qty -= consume;
            toSell -= consume;
          }
        }
      }

      // Sum remaining quantities
      for (const [ticker, tickerLots] of lots) {
        const qty = tickerLots.reduce((s, l) => s + l.qty, 0);
        if (qty > 0.0001) holdingsMap.set(ticker, qty);
      }

      // Compute holdings value
      let holdingsValue = 0;
      for (const [ticker, qty] of holdingsMap) {
        const price = getPrice(ticker, dateStr);
        holdingsValue += qty * price;
      }

      // Cash balance up to this date
      let cash = 0;
      for (const tx of txsUpToDate) {
        if (tx.type === 'deposit') cash += tx.amount || 0;
        else if (tx.type === 'withdrawal') cash -= tx.amount || 0;
        else if (tx.type === 'buy') cash -= (tx.quantity || 0) * (tx.price_per_unit || 0) + (tx.commission || 0);
        else if (tx.type === 'sell') cash += (tx.quantity || 0) * (tx.price_per_unit || 0) - (tx.commission || 0);
        else if (tx.type === 'dividend') cash += tx.amount || 0;
      }

      const portfolioValue = holdingsValue + cash;

      // Cumulative deposits
      const depositsCumulative = txsUpToDate
        .filter(tx => tx.type === 'deposit')
        .reduce((s, tx) => s + (tx.amount || 0), 0);

      // S&P 500 normalized (start at same value as first portfolio point)
      const spyPrice = getPrice('SPY', dateStr);
      const sp500Normalized = firstSpyPrice > 0 && dataPoints.length === 0
        ? portfolioValue // first point matches portfolio
        : firstSpyPrice > 0
          ? (spyPrice / firstSpyPrice) * (dataPoints[0]?.portfolio_value || portfolioValue)
          : 0;

      dataPoints.push({
        date: dateStr,
        portfolio_value: Math.round(portfolioValue * 100) / 100,
        sp500_normalized: Math.round(sp500Normalized * 100) / 100,
        deposits_cumulative: Math.round(depositsCumulative * 100) / 100,
      });
    }

    return NextResponse.json({ data: dataPoints });
  } catch (err) {
    console.error('[API/portfolio/history] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
