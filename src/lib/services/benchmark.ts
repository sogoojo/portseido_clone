import db from '@/lib/db';
import { getHistoricalPrices, getCurrentPrice } from '@/lib/services/prices';
import { convert, getHistoricalRate } from '@/lib/services/fx';
import type { Transaction } from '@/lib/types';

export interface CounterfactualResult {
  counterfactual_value: number;
  your_value: number;
  total_deposited: number;
  difference: number;
  difference_pct: number;
  counterfactual_return_pct: number;
  your_return_pct: number;
  currency: string;
}

export async function calculateCounterfactual(accountId?: string): Promise<CounterfactualResult> {
  // Get all deposit and withdrawal transactions. Aggregate ('all') isolates
  // NGX — its NGN cash flows are excluded from the S&P counterfactual too.
  const single = accountId && accountId !== 'all';
  const condition = single ? 'AND t.account_id = ?' : `AND a.currency != 'NGN'`;
  const params: string[] = single ? [accountId] : [];

  const cashFlows = db.prepare(
    `SELECT t.date, t.type, t.amount, t.currency, a.currency as account_currency
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.type IN ('deposit', 'withdrawal') ${condition}
     ORDER BY t.date`
  ).all(...params) as (Pick<Transaction, 'date' | 'type' | 'amount' | 'currency'> & { account_currency: string })[];

  if (cashFlows.length === 0) {
    return {
      counterfactual_value: 0,
      your_value: 0,
      total_deposited: 0,
      difference: 0,
      difference_pct: 0,
      counterfactual_return_pct: 0,
      your_return_pct: 0,
      currency: 'USD',
    };
  }

  // Get SPY historical prices for all deposit dates — start a week early so
  // a first deposit on a weekend/holiday still finds a prior trading day
  const firstDate = new Date(cashFlows[0].date);
  firstDate.setDate(firstDate.getDate() - 7);
  const today = new Date();
  const spyHistory = await getHistoricalPrices('SPY', firstDate, today);

  // Build a lookup map: date -> close price
  const spyPriceMap = new Map<string, number>();
  for (const row of spyHistory) {
    spyPriceMap.set(row.date, row.close);
  }

  // Helper: find closest SPY price on or before a given date
  function findSpyPrice(dateStr: string): number | null {
    // Try exact date
    if (spyPriceMap.has(dateStr)) return spyPriceMap.get(dateStr)!;
    // Try up to 5 days before (weekends/holidays)
    const d = new Date(dateStr);
    for (let i = 1; i <= 5; i++) {
      d.setDate(d.getDate() - 1);
      const key = d.toISOString().split('T')[0];
      if (spyPriceMap.has(key)) return spyPriceMap.get(key)!;
    }
    return null;
  }

  // Calculate hypothetical SPY shares from deposits/withdrawals
  let totalSpyShares = 0;
  let totalDepositedUsd = 0;

  for (const cf of cashFlows) {
    if (!cf.amount) continue;

    // Convert at the FX rate of the deposit date — converting a years-old
    // deposit at today's rate buys the wrong number of historical SPY shares
    const ccy = (cf.currency || cf.account_currency).toUpperCase();
    const rate = ccy === 'USD' ? 1 : await getHistoricalRate(ccy, 'USD', cf.date);
    const amountUsd = cf.amount * rate;
    const spyPrice = findSpyPrice(cf.date);

    if (!spyPrice) continue;

    if (cf.type === 'deposit') {
      totalSpyShares += amountUsd / spyPrice;
      totalDepositedUsd += amountUsd;
    } else if (cf.type === 'withdrawal') {
      totalSpyShares -= amountUsd / spyPrice;
      totalDepositedUsd -= amountUsd;
    }
  }

  // Get current SPY price
  const currentSpy = await getCurrentPrice('SPY');
  const currentSpyPrice = currentSpy.price ?? 0;
  const counterfactualValue = totalSpyShares * currentSpyPrice;

  // Get actual portfolio value
  // Import here to avoid circular dependency at module level
  const { getAggregateValue, getPortfolioValue } = await import('@/lib/services/portfolio');

  let yourValue: number;
  if (!accountId || accountId === 'all') {
    const agg = await getAggregateValue();
    yourValue = agg.total_usd;
  } else {
    const pv = await getPortfolioValue(accountId);
    yourValue = await convert(pv.value, pv.currency, 'USD');
  }

  const difference = yourValue - counterfactualValue;
  const differencePct = counterfactualValue > 0 ? (difference / counterfactualValue) * 100 : 0;
  const counterfactualReturnPct = totalDepositedUsd > 0 ? ((counterfactualValue - totalDepositedUsd) / totalDepositedUsd) * 100 : 0;
  const yourReturnPct = totalDepositedUsd > 0 ? ((yourValue - totalDepositedUsd) / totalDepositedUsd) * 100 : 0;

  return {
    counterfactual_value: counterfactualValue,
    your_value: yourValue,
    total_deposited: totalDepositedUsd,
    difference,
    difference_pct: differencePct,
    counterfactual_return_pct: counterfactualReturnPct,
    your_return_pct: yourReturnPct,
    currency: 'USD',
  };
}
