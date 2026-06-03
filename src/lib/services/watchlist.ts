import db from '@/lib/db';
import { getWatchlist } from './summaries';
import { getCurrentPrice } from './prices';
import type { WatchlistRow, BuySignal } from '@/lib/types';

// Buy signal from how far below the (dynamic) fair-entry the price trades.
// distance = (fair_entry - price) / price, so positive = trading below fair value.
function signalFor(distance: number | null): BuySignal {
  if (distance == null) return 'none';
  if (distance >= 0.15) return 'strong_buy'; // 15%+ below fair entry
  if (distance >= 0.05) return 'buy';        // 5–15% below
  if (distance >= -0.05) return 'watch';     // around fair entry
  return 'hold';                             // trading above fair entry
}

interface AnalystRow {
  target_mean: number | null;
  recommendation_key: string | null;
}

function latestAnalyst(ticker: string): AnalystRow | null {
  const row = db.prepare(
    `SELECT target_mean, recommendation_key FROM daily_summaries
     WHERE ticker = ? ORDER BY date DESC LIMIT 1`
  ).get(ticker) as AnalystRow | undefined;
  return row ?? null;
}

export async function getWatchlistRows(): Promise<WatchlistRow[]> {
  const items = getWatchlist();

  const rows = await Promise.all(items.map(async (item): Promise<WatchlistRow> => {
    const pr = await getCurrentPrice(item.ticker);
    const price = pr.price;
    const high = pr.fiftyTwoWeekHigh;
    const analyst = latestAnalyst(item.ticker);

    // Dynamic "fair entry" = blend of (200-day MA − 5%) and (analyst target − 20%),
    // averaging whichever are available so it self-updates daily.
    const candidates: number[] = [];
    if (pr.twoHundredDayAverage != null) candidates.push(pr.twoHundredDayAverage * 0.95);
    if (analyst?.target_mean != null) candidates.push(analyst.target_mean * 0.80);
    const dynamicTarget = candidates.length
      ? candidates.reduce((a, b) => a + b, 0) / candidates.length
      : null;

    // Dynamic drives the signal; the manual entry is a fallback when no dynamic
    // inputs exist (e.g. crypto with no analysts and no MA).
    const effectiveTarget = dynamicTarget ?? item.target_entry ?? null;
    const targetBasis: WatchlistRow['target_basis'] =
      dynamicTarget != null ? 'dynamic' : item.target_entry != null ? 'fixed' : 'none';

    const distance =
      effectiveTarget != null && price ? (effectiveTarget - price) / price : null;
    const pctFromHigh = price && high ? (price - high) / high : null;
    const analystUpside =
      analyst?.target_mean != null && price ? (analyst.target_mean - price) / price : null;

    return {
      ...item,
      price,
      currency: pr.currency,
      dynamic_target: dynamicTarget,
      effective_target: effectiveTarget,
      target_basis: targetBasis,
      distance,
      signal: signalFor(distance),
      fifty_two_week_high: high,
      pct_from_high: pctFromHigh,
      knife: pctFromHigh != null && pctFromHigh < -0.30,
      analyst_upside: analystUpside,
      recommendation_key: analyst?.recommendation_key ?? null,
      stale: pr.stale,
    };
  }));

  // Strongest buy signals first.
  const order: Record<BuySignal, number> = { strong_buy: 0, buy: 1, watch: 2, hold: 3, none: 4 };
  rows.sort((a, b) => {
    const r = order[a.signal] - order[b.signal];
    if (r !== 0) return r;
    return (b.distance ?? -Infinity) - (a.distance ?? -Infinity);
  });

  return rows;
}
