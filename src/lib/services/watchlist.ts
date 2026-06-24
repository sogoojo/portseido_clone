import db from '@/lib/db';
import { getWatchlist } from './summaries';
import { getMultipleCurrentPrices, getHistoricalPrices } from './prices';
import type { WatchlistRow, BuySignal, TrendState, ThesisState, EarningsTrendPoint } from '@/lib/types';

// Cheapness grade: how far below the (dynamic) fair entry the price trades.
// distance = (fair_entry - price) / price, so positive = trading below fair value.
function cheapnessFor(distance: number | null): BuySignal {
  if (distance == null) return 'none';
  if (distance >= 0.15) return 'strong_buy'; // 15%+ below fair entry
  if (distance >= 0.05) return 'buy';        // 5–15% below
  if (distance >= -0.05) return 'watch';     // around fair entry
  return 'hold';                             // trading above fair entry
}

// Price-trend from the 50/200-day moving-average stack.
function trendFor(price: number | null, ma50: number | null, ma200: number | null): TrendState {
  if (price == null || ma50 == null || ma200 == null) return 'unknown';
  if (price < ma50 && ma50 < ma200) return 'downtrend';
  if (price > ma50 && ma50 > ma200) return 'uptrend';
  return 'neutral';
}

// Trend-based falling knife: in a downtrend AND sitting in the bottom of its
// 52-week range (still falling / near lows), not merely below an old high.
function isKnife(
  trend: TrendState, price: number | null, low: number | null, high: number | null, ma200: number | null
): boolean {
  if (trend !== 'downtrend' || price == null) return false;
  if (low != null && high != null && high > low) {
    const rangePos = (price - low) / (high - low); // 0 = at low, 1 = at high
    return rangePos < 0.35;
  }
  // Fallback when 52w range missing: >15% below the 200-day MA
  return ma200 != null ? price < ma200 * 0.85 : false;
}

interface AnalystRow {
  target_mean: number | null;
  recommendation_key: string | null;
  earnings_trend: string | null;
}

const latestAnalystStmt = db.prepare(
  `SELECT target_mean, recommendation_key, earnings_trend FROM daily_summaries
   WHERE ticker = ? ORDER BY date DESC LIMIT 1`
);

function latestAnalyst(ticker: string): AnalystRow | null {
  const row = latestAnalystStmt.get(ticker) as AnalystRow | undefined;
  return row ?? null;
}

// Thesis from next-year EPS revision momentum (analysts raising vs cutting).
function thesisFor(earningsTrendJson: string | null): ThesisState {
  if (!earningsTrendJson) return 'unknown';
  let trend: EarningsTrendPoint[] = [];
  try { trend = JSON.parse(earningsTrendJson); } catch { return 'unknown'; }
  const ny = trend.find(t => t.period === '+1y');
  if (!ny || (ny.eps_up_30d == null && ny.eps_down_30d == null)) return 'unknown';
  const net = (ny.eps_up_30d ?? 0) - (ny.eps_down_30d ?? 0);
  if (net <= -3) return 'weakening';
  if (net >= 3) return 'improving';
  return 'stable';
}

// Thesis-aware verdict: combine cheapness with trend (knife) and thesis.
//  - knife + weakening thesis → Avoid (cheap but broken & falling)
//  - knife (thesis ok)        → cap buys to Watch (wait for it to stop falling)
//  - not knife + weakening    → cap buys to Watch (caution)
//  - otherwise                → cheapness grade stands
function verdictFor(cheapness: BuySignal, knife: boolean, thesis: ThesisState): BuySignal {
  const isBuy = cheapness === 'strong_buy' || cheapness === 'buy';
  const weakening = thesis === 'weakening';
  if (knife) {
    if (weakening) return 'avoid';
    return isBuy ? 'watch' : cheapness;
  }
  if (weakening && isBuy) return 'watch';
  return cheapness;
}

// NGX quotes don't carry 52w range or moving averages (no Yahoo data) —
// compute them from the cached TradingView candle history instead.
interface CandleStats {
  high: number | null;
  low: number | null;
  ma50: number | null;
  ma200: number | null;
  ytdBase: number | null; // last close before Jan 1 of the current year
}

async function ngxCandleStats(ticker: string): Promise<CandleStats | null> {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 430); // 200 trading days ≈ 290 calendar + 52w window
  const rows = await getHistoricalPrices(ticker, from, to);
  if (rows.length === 0) return null;

  const closes = rows.map(r => r.close);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ma50 = closes.length >= 30 ? avg(closes.slice(-50)) : null;
  const ma200 = closes.length >= 120 ? avg(closes.slice(-200)) : null;

  const yearAgo = new Date(to);
  yearAgo.setDate(yearAgo.getDate() - 365);
  const yearAgoStr = yearAgo.toISOString().split('T')[0];
  const lastYear = rows.filter(r => r.date >= yearAgoStr);
  const high = lastYear.length ? Math.max(...lastYear.map(r => r.high ?? r.close)) : null;
  const low = lastYear.length ? Math.min(...lastYear.map(r => r.low ?? r.close)) : null;

  const jan1 = `${to.getFullYear()}-01-01`;
  const priorYearRows = rows.filter(r => r.date < jan1);
  const ytdBase = priorYearRows.length ? priorYearRows[priorYearRows.length - 1].close : null;

  return { high, low, ma50, ma200, ytdBase };
}

// YTD base = last close before Jan 1. A fixed window around the year boundary
// keeps the price_cache coverage check valid all year after one Yahoo fetch.
async function ytdBaseFor(ticker: string): Promise<number | null> {
  const year = new Date().getFullYear();
  const from = new Date(`${year - 1}-12-01T00:00:00Z`);
  const to = new Date(`${year}-01-15T00:00:00Z`);
  try {
    const rows = await getHistoricalPrices(ticker, from, to);
    const prior = rows.filter(r => r.date < `${year}-01-01`);
    return prior.length ? prior[prior.length - 1].close : null;
  } catch {
    return null;
  }
}

export async function getWatchlistRows(): Promise<WatchlistRow[]> {
  const items = getWatchlist();

  // One batched Yahoo/TradingView call for all uncached tickers
  const prices = await getMultipleCurrentPrices(items.map(i => i.ticker));
  const priceMap = new Map(prices.map(p => [p.ticker, p]));

  // YTD base for global (Yahoo) tickers — NGX gets it from candle stats below
  const globalTickers = items.filter(i => !i.ticker.startsWith('NSENG:')).map(i => i.ticker);
  const ytdBases = await Promise.all(globalTickers.map(t => ytdBaseFor(t)));
  const ytdBaseMap = new Map(globalTickers.map((t, i) => [t, ytdBases[i]]));

  // Candle-derived stats for NGX rows (cached in SQLite after the first load)
  const statsMap = new Map<string, CandleStats>();
  for (const item of items) {
    if (!item.ticker.startsWith('NSENG:')) continue;
    const stats = await ngxCandleStats(item.ticker);
    if (stats) statsMap.set(item.ticker, stats);
  }

  const rows = items.map((item): WatchlistRow => {
    const pr = priceMap.get(item.ticker)!;
    const stats = statsMap.get(item.ticker);
    const price = pr.price;
    const high = pr.fiftyTwoWeekHigh ?? stats?.high ?? null;
    const low = pr.fiftyTwoWeekLow ?? stats?.low ?? null;
    const ma50 = pr.fiftyDayAverage ?? stats?.ma50 ?? null;
    const ma200 = pr.twoHundredDayAverage ?? stats?.ma200 ?? null;
    const analyst = latestAnalyst(item.ticker);

    // Your hand-set anchor (target_entry) always wins. The dynamic blend —
    // (200-day MA − 5%) averaged with (analyst target − 20%) — is only a
    // fallback for tickers you haven't priced yourself (e.g. NGX names).
    const candidates: number[] = [];
    if (ma200 != null) candidates.push(ma200 * 0.95);
    if (analyst?.target_mean != null) candidates.push(analyst.target_mean * 0.80);
    const dynamicTarget = candidates.length
      ? candidates.reduce((a, b) => a + b, 0) / candidates.length
      : null;

    const effectiveTarget = item.target_entry ?? dynamicTarget ?? null;
    const targetBasis: WatchlistRow['target_basis'] =
      item.target_entry != null ? 'fixed' : dynamicTarget != null ? 'dynamic' : 'none';

    const distance =
      effectiveTarget != null && price ? (effectiveTarget - price) / price : null;
    const pctFromHigh = price && high ? (price - high) / high : null;
    const analystUpside =
      analyst?.target_mean != null && price ? (analyst.target_mean - price) / price : null;

    const trend = trendFor(price, ma50, ma200);
    const knife = isKnife(trend, price, low, high, ma200);
    const thesis = thesisFor(analyst?.earnings_trend ?? null);
    const cheapness = cheapnessFor(distance);
    const signal = verdictFor(cheapness, knife, thesis);

    return {
      ...item,
      price,
      currency: pr.currency,
      dynamic_target: dynamicTarget,
      effective_target: effectiveTarget,
      target_basis: targetBasis,
      distance,
      signal,
      cheapness,
      fifty_two_week_high: high,
      pct_from_high: pctFromHigh,
      trend,
      knife,
      thesis,
      analyst_upside: analystUpside,
      recommendation_key: analyst?.recommendation_key ?? null,
      ytd_change: (() => {
        const base = stats?.ytdBase ?? ytdBaseMap.get(item.ticker) ?? null;
        return price != null && base ? (price - base) / base : null;
      })(),
      stale: pr.stale,
    };
  });

  // Best verdicts first.
  const order: Record<BuySignal, number> = { strong_buy: 0, buy: 1, watch: 2, hold: 3, avoid: 4, none: 5 };
  rows.sort((a, b) => {
    const r = order[a.signal] - order[b.signal];
    if (r !== 0) return r;
    return (b.distance ?? -Infinity) - (a.distance ?? -Infinity);
  });

  return rows;
}
