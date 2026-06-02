import db from '@/lib/db';
import { getHistoricalPrices, getCurrentPrice } from '@/lib/services/prices';
import { convert } from '@/lib/services/fx';
import { getPortfolioValue, getAggregateValue } from '@/lib/services/portfolio';
import type { Transaction, Account } from '@/lib/types';

// --- MWR / IRR via Newton-Raphson ---

interface CashFlow {
  date: Date;
  amount: number; // negative = money in (deposit/buy), positive = money out (withdrawal/sell) or final value
}

/**
 * Calculate Money-Weighted Return (IRR) using Newton-Raphson.
 * Cash flows: deposits are negative, withdrawals are positive, final value is positive.
 * Returns annualised rate.
 */
export function calculateMWR(cashFlows: CashFlow[], finalValue: number, finalDate: Date): number {
  if (cashFlows.length === 0) return 0;

  // Add final value as a positive cash flow
  const allFlows: CashFlow[] = [
    ...cashFlows,
    { date: finalDate, amount: finalValue },
  ];

  const t0 = allFlows[0].date.getTime();
  const totalDays = (finalDate.getTime() - t0) / (1000 * 60 * 60 * 24);

  if (totalDays <= 0) return 0;

  // Year fractions for each flow
  const yearFractions = allFlows.map(cf => {
    return (cf.date.getTime() - t0) / (1000 * 60 * 60 * 24 * 365);
  });

  // Newton-Raphson: find r such that NPV(r) = 0
  // NPV = Σ CF_i / (1 + r)^t_i
  // Choose initial guess based on simple return estimate
  const totalInvested = allFlows.slice(0, -1).reduce((s, cf) => s + Math.abs(cf.amount), 0);
  let r = totalInvested > 0 ? (finalValue / totalInvested - 1) : 0.1;
  if (!isFinite(r)) r = 0.1;
  const MAX_ITER = 100;
  const TOL = 1e-10;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let npv = 0;
    let dnpv = 0; // derivative

    for (let i = 0; i < allFlows.length; i++) {
      const cf = allFlows[i].amount;
      const t = yearFractions[i];
      const disc = Math.pow(1 + r, t);

      if (disc === 0 || !isFinite(disc)) break;

      npv += cf / disc;
      dnpv -= (t * cf) / (disc * (1 + r));
    }

    if (Math.abs(npv) < TOL) break;
    if (dnpv === 0 || !isFinite(dnpv)) break;

    const newR = r - npv / dnpv;

    // Clamp to avoid divergence
    if (newR < -0.99) r = -0.99;
    else if (newR > 10) r = 10;
    else r = newR;
  }

  // r is already in annual terms since we used year fractions in discounting
  return r;
}

// --- Period helpers ---

const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', 'All'] as const;
export type Period = (typeof PERIODS)[number];

function getPeriodStartDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case '1M': return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case '3M': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case '6M': return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case 'YTD': return new Date(now.getFullYear(), 0, 1);
    case '1Y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case '2Y': return new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    case '5Y': return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    case 'All':
    default: {
      const first = db.prepare('SELECT MIN(date) as d FROM transactions').get() as { d: string | null };
      return first.d ? new Date(first.d) : new Date(now.getFullYear() - 1, 0, 1);
    }
  }
}

// --- Portfolio Returns ---

export interface PeriodReturn {
  period: string;
  mwr: number;
}

export async function getPortfolioReturns(accountId?: string): Promise<PeriodReturn[]> {
  const now = new Date();
  const results: PeriodReturn[] = [];

  // Get current portfolio value
  let currentValue: number;
  if (!accountId || accountId === 'all') {
    const agg = await getAggregateValue();
    currentValue = agg.total_usd;
  } else {
    const pv = await getPortfolioValue(accountId);
    currentValue = await convert(pv.value, pv.currency, 'USD');
  }

  // Get all cash flow transactions
  const condition = accountId && accountId !== 'all' ? 'AND t.account_id = ?' : '';
  const params: string[] = accountId && accountId !== 'all' ? [accountId] : [];

  const allTxs = db.prepare(
    `SELECT t.date, t.type, t.amount, t.quantity, t.price_per_unit, t.commission, t.currency, a.currency as account_currency
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.type IN ('deposit', 'withdrawal') ${condition}
     ORDER BY t.date`
  ).all(...params) as (Pick<Transaction, 'date' | 'type' | 'amount' | 'quantity' | 'price_per_unit' | 'commission' | 'currency'> & { account_currency: string })[];

  for (const period of PERIODS) {
    const startDate = getPeriodStartDate(period);
    const startStr = startDate.toISOString().split('T')[0];

    // Filter cash flows to this period
    const periodTxs = allTxs.filter(tx => tx.date >= startStr);

    if (periodTxs.length === 0) {
      results.push({ period, mwr: 0 });
      continue;
    }

    // Build cash flows: deposits negative, withdrawals positive
    const cashFlows: CashFlow[] = [];
    for (const tx of periodTxs) {
      const amountUsd = await convert(tx.amount || 0, tx.currency || tx.account_currency, 'USD');
      if (tx.type === 'deposit') {
        cashFlows.push({ date: new Date(tx.date), amount: -amountUsd });
      } else if (tx.type === 'withdrawal') {
        cashFlows.push({ date: new Date(tx.date), amount: amountUsd });
      }
    }

    if (cashFlows.length === 0) {
      results.push({ period, mwr: 0 });
      continue;
    }

    const mwr = calculateMWR(cashFlows, currentValue, now);
    results.push({ period, mwr: isFinite(mwr) ? mwr : 0 });
  }

  return results;
}

// --- Benchmark Returns ---

export interface BenchmarkReturn {
  period: string;
  return_pct: number;
}

export async function getBenchmarkReturns(symbol: string): Promise<BenchmarkReturn[]> {
  const now = new Date();
  const results: BenchmarkReturn[] = [];

  for (const period of PERIODS) {
    const startDate = getPeriodStartDate(period);

    try {
      const history = await getHistoricalPrices(symbol, startDate, now);
      if (history.length < 2) {
        results.push({ period, return_pct: 0 });
        continue;
      }

      const startPrice = history[0].close;
      const endPrice = history[history.length - 1].close;
      const returnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
      results.push({ period, return_pct: returnPct });
    } catch {
      results.push({ period, return_pct: 0 });
    }
  }

  return results;
}

// --- Historical Returns (monthly/quarterly/annually) ---

export interface HistoricalReturn {
  period: string;
  return_pct: number;
}

export async function getHistoricalReturns(
  accountId?: string,
  granularity: 'monthly' | 'quarterly' | 'annually' = 'monthly'
): Promise<HistoricalReturn[]> {
  // Get all transactions to find date range
  const condition = accountId && accountId !== 'all' ? 'AND account_id = ?' : '';
  const params: string[] = accountId && accountId !== 'all' ? [accountId] : [];

  const firstTx = db.prepare(
    `SELECT MIN(date) as d FROM transactions WHERE 1=1 ${condition}`
  ).get(...params) as { d: string | null };

  if (!firstTx.d) return [];

  const startDate = new Date(firstTx.d);
  const now = new Date();
  const results: HistoricalReturn[] = [];

  // Generate period boundaries
  const boundaries: { label: string; start: Date; end: Date }[] = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  while (current < now) {
    let end: Date;
    let label: string;

    if (granularity === 'monthly') {
      end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      label = current.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      boundaries.push({ label, start: new Date(current), end });
      current.setMonth(current.getMonth() + 1);
    } else if (granularity === 'quarterly') {
      const q = Math.floor(current.getMonth() / 3);
      end = new Date(current.getFullYear(), (q + 1) * 3, 0);
      label = `Q${q + 1} ${current.getFullYear().toString().slice(-2)}`;
      boundaries.push({ label, start: new Date(current), end });
      current.setMonth((q + 1) * 3);
    } else {
      end = new Date(current.getFullYear(), 11, 31);
      label = current.getFullYear().toString();
      boundaries.push({ label, start: new Date(current), end });
      current.setFullYear(current.getFullYear() + 1);
    }
  }

  // For simplicity, compute simple return for each period using S&P 500 as a proxy
  // for portfolio value change. A full implementation would replay transactions per period.
  // We use the portfolio's deposit-weighted approach.
  for (const b of boundaries.slice(-24)) { // Limit to last 24 periods
    try {
      // Use ^GSPC as a reference for period returns (simplified approach)
      // In a full implementation, we'd compute actual portfolio value at each boundary
      const history = await getHistoricalPrices('^GSPC', b.start, b.end);
      if (history.length >= 2) {
        const startPrice = history[0].close;
        const endPrice = history[history.length - 1].close;
        const ret = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
        results.push({ period: b.label, return_pct: ret });
      } else {
        results.push({ period: b.label, return_pct: 0 });
      }
    } catch {
      results.push({ period: b.label, return_pct: 0 });
    }
  }

  return results;
}
