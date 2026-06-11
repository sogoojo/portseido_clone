import db from '@/lib/db';
import { getHistoricalPrices } from '@/lib/services/prices';
import { convert } from '@/lib/services/fx';
import { getPortfolioValue, getAggregateValue } from '@/lib/services/portfolio';
import { buildValuationContext } from '@/lib/services/history';

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

function getPeriodStartDate(period: Period, firstTxDate?: string | null): Date {
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
      if (firstTxDate) return new Date(firstTxDate);
      const first = db.prepare('SELECT MIN(date) as d FROM transactions').get() as { d: string | null };
      return first.d ? new Date(first.d) : new Date(now.getFullYear() - 1, 0, 1);
    }
  }
}

// --- Portfolio Returns ---

export interface PeriodReturn {
  period: string;
  /** Cumulative money-weighted return over the period as a fraction (0.1 = +10%). null = no data for the period. */
  mwr: number | null;
}

export async function getPortfolioReturns(accountId?: string): Promise<PeriodReturn[]> {
  const now = new Date();

  // Current portfolio value in USD (live prices)
  let currentValue: number;
  if (!accountId || accountId === 'all') {
    const agg = await getAggregateValue();
    currentValue = agg.total_usd;
  } else {
    const pv = await getPortfolioValue(accountId);
    currentValue = await convert(pv.value, pv.currency, 'USD');
  }

  const ctx = await buildValuationContext(accountId === 'all' ? undefined : accountId, now);
  if (!ctx.firstDate) {
    return PERIODS.map(period => ({ period, mwr: null }));
  }

  // Evaluate periods oldest-start first so the valuation replay runs forward
  const ordered = PERIODS
    .map(period => ({ period, start: getPeriodStartDate(period, ctx.firstDate) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const byPeriod = new Map<string, number | null>();

  for (const { period, start } of ordered) {
    const startStr = start.toISOString().split('T')[0];

    // Portfolio value at the period start is the opening cash flow — without
    // it, a period's MWR is meaningless (a month with no deposits is not 0%)
    const startValue = startStr > ctx.firstDate ? ctx.valueAt(startStr).total : 0;

    const cashFlows: CashFlow[] = [];
    if (startValue > 0.01) {
      cashFlows.push({ date: start, amount: -startValue });
    }
    // Flows strictly after the start date — the start value already includes
    // everything up to and including startStr
    for (const f of ctx.flows) {
      if (f.date > startStr) {
        cashFlows.push({ date: new Date(f.date), amount: f.amountUsd });
      }
    }

    if (cashFlows.length === 0) {
      byPeriod.set(period, null);
      continue;
    }

    const annualised = calculateMWR(cashFlows, currentValue, now);
    if (!isFinite(annualised)) {
      byPeriod.set(period, null);
      continue;
    }

    // Convert the annualised IRR into a cumulative return over the period so
    // it is directly comparable with benchmark period returns
    const t0 = cashFlows[0].date.getTime();
    const years = (now.getTime() - t0) / (1000 * 60 * 60 * 24 * 365);
    const cumulative = years > 0 ? Math.pow(1 + annualised, years) - 1 : 0;
    byPeriod.set(period, isFinite(cumulative) ? cumulative : null);
  }

  return PERIODS.map(period => ({ period, mwr: byPeriod.get(period) ?? null }));
}

// --- Benchmark Returns ---

export interface BenchmarkReturn {
  period: string;
  /** Cumulative simple return over the period in percent. null = no data. */
  return_pct: number | null;
}

export async function getBenchmarkReturns(symbol: string): Promise<BenchmarkReturn[]> {
  const now = new Date();
  const results: BenchmarkReturn[] = [];

  for (const period of PERIODS) {
    const startDate = getPeriodStartDate(period);

    try {
      const history = await getHistoricalPrices(symbol, startDate, now);
      if (history.length < 2) {
        results.push({ period, return_pct: null });
        continue;
      }

      const startPrice = history[0].close;
      const endPrice = history[history.length - 1].close;
      const returnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : null;
      results.push({ period, return_pct: returnPct });
    } catch {
      results.push({ period, return_pct: null });
    }
  }

  return results;
}

// --- Historical Returns (monthly/quarterly/annually) ---

export interface HistoricalReturn {
  period: string;
  /** Portfolio return for the period in percent (simple Dietz). null = not computable. */
  return_pct: number | null;
}

export async function getHistoricalReturns(
  accountId?: string,
  granularity: 'monthly' | 'quarterly' | 'annually' = 'monthly'
): Promise<HistoricalReturn[]> {
  const now = new Date();
  const ctx = await buildValuationContext(accountId === 'all' ? undefined : accountId, now);
  if (!ctx.firstDate) return [];

  const startDate = new Date(ctx.firstDate);
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

  // Actual portfolio return per period via simple Dietz:
  // r = (V_end - V_start - F) / (V_start + F/2), F = net external flows
  for (const b of boundaries.slice(-24)) { // Limit to last 24 periods
    const dayBeforeStart = new Date(b.start);
    dayBeforeStart.setDate(dayBeforeStart.getDate() - 1);
    const startStr = dayBeforeStart.toISOString().split('T')[0];
    const end = b.end < now ? b.end : now;
    const endStr = end.toISOString().split('T')[0];

    const vStart = ctx.valueAt(startStr);
    const vEnd = ctx.valueAt(endStr);
    const netFlow = vEnd.net_deposits - vStart.net_deposits;

    const denominator = vStart.total + netFlow / 2;
    if (denominator <= 0.01) {
      results.push({ period: b.label, return_pct: null });
      continue;
    }

    const ret = ((vEnd.total - vStart.total - netFlow) / denominator) * 100;
    results.push({ period: b.label, return_pct: isFinite(ret) ? ret : null });
  }

  return results;
}
