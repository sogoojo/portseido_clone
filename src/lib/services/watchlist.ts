import db from '@/lib/db';
import { getWatchlist } from './summaries';
import { getCurrentPrice } from './prices';
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

function latestAnalyst(ticker: string): AnalystRow | null {
  const row = db.prepare(
    `SELECT target_mean, recommendation_key, earnings_trend FROM daily_summaries
     WHERE ticker = ? ORDER BY date DESC LIMIT 1`
  ).get(ticker) as AnalystRow | undefined;
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

export async function getWatchlistRows(): Promise<WatchlistRow[]> {
  const items = getWatchlist();

  const rows = await Promise.all(items.map(async (item): Promise<WatchlistRow> => {
    const pr = await getCurrentPrice(item.ticker);
    const price = pr.price;
    const high = pr.fiftyTwoWeekHigh;
    const low = pr.fiftyTwoWeekLow;
    const analyst = latestAnalyst(item.ticker);

    // Dynamic "fair entry" = blend of (200-day MA − 5%) and (analyst target − 20%).
    const candidates: number[] = [];
    if (pr.twoHundredDayAverage != null) candidates.push(pr.twoHundredDayAverage * 0.95);
    if (analyst?.target_mean != null) candidates.push(analyst.target_mean * 0.80);
    const dynamicTarget = candidates.length
      ? candidates.reduce((a, b) => a + b, 0) / candidates.length
      : null;

    const effectiveTarget = dynamicTarget ?? item.target_entry ?? null;
    const targetBasis: WatchlistRow['target_basis'] =
      dynamicTarget != null ? 'dynamic' : item.target_entry != null ? 'fixed' : 'none';

    const distance =
      effectiveTarget != null && price ? (effectiveTarget - price) / price : null;
    const pctFromHigh = price && high ? (price - high) / high : null;
    const analystUpside =
      analyst?.target_mean != null && price ? (analyst.target_mean - price) / price : null;

    const trend = trendFor(price, pr.fiftyDayAverage, pr.twoHundredDayAverage);
    const knife = isKnife(trend, price, low, high, pr.twoHundredDayAverage);
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
      stale: pr.stale,
    };
  }));

  // Best verdicts first.
  const order: Record<BuySignal, number> = { strong_buy: 0, buy: 1, watch: 2, hold: 3, avoid: 4, none: 5 };
  rows.sort((a, b) => {
    const r = order[a.signal] - order[b.signal];
    if (r !== 0) return r;
    return (b.distance ?? -Infinity) - (a.distance ?? -Infinity);
  });

  return rows;
}
