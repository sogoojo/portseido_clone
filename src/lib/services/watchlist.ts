import db from '@/lib/db';
import { getWatchlist } from './summaries';
import { getCurrentPrice } from './prices';
import type { WatchlistRow, BuySignal } from '@/lib/types';

// Buy signal from how far price is below the target entry.
function signalFor(distance: number | null): BuySignal {
  if (distance == null) return 'none';
  if (distance >= 0) return 'strong_buy';   // at or below target entry
  if (distance >= -0.05) return 'buy';       // within 5%
  if (distance >= -0.15) return 'watch';     // within 15%
  return 'hold';                             // far above target
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

    const distance =
      item.target_entry != null && price ? (item.target_entry - price) / price : null;
    const pctFromHigh = price && high ? (price - high) / high : null;
    const analyst = latestAnalyst(item.ticker);
    const analystUpside =
      analyst?.target_mean != null && price ? (analyst.target_mean - price) / price : null;

    return {
      ...item,
      price,
      currency: pr.currency,
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
