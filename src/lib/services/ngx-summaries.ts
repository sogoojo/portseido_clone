import db from '@/lib/db';
import { getHistoricalPrices, getMultipleCurrentPrices } from '@/lib/services/prices';
import { retDaysAgo, sma } from '@/lib/services/rotation';
import { refreshNgxNews, getNgxNewsByTicker } from '@/lib/services/ngx-news';
import { refreshNgxFundamentals, getNgxFundamentals } from '@/lib/services/ngx-fundamentals';
import type { NgxSummary } from '@/lib/types';

// Trading-day windows (NGX trades roughly the same ~252 days/year as US markets,
// so position-based lookbacks line up even though the holiday calendar differs).
const W5 = 5;
const W1M = 21;
const W3M = 63;
const W6M = 126;
const W1Y = 252;

// ~14 months of calendar days — enough for a 1Y return plus a 200-day MA, with
// slack for NGX holidays/halts thinning the candle count.
const HISTORY_DAYS = 430;

interface NamedTicker {
  ticker: string;
  name: string | null;
}

/**
 * NGX tickers worth summarising: currently-held Nigerian positions plus any NGX
 * watchlist names. Names come from the watchlist first (richest source), then
 * ticker_metadata, else null (the UI falls back to the bare symbol).
 */
function ngxTickers(): NamedTicker[] {
  const held = db.prepare(`
    SELECT ticker FROM (
      SELECT ticker,
        SUM(CASE WHEN type = 'buy' THEN quantity ELSE 0 END) AS bought,
        SUM(CASE WHEN type = 'sell' THEN quantity ELSE 0 END) AS sold
      FROM transactions
      WHERE ticker LIKE 'NSENG:%' AND type IN ('buy', 'sell')
      GROUP BY ticker
    ) WHERE bought > sold + 0.0001
  `).all() as { ticker: string }[];

  const watch = db.prepare(
    `SELECT ticker, name FROM watchlist WHERE ticker LIKE 'NSENG:%'`
  ).all() as { ticker: string; name: string | null }[];

  const meta = db.prepare(
    `SELECT ticker, name FROM ticker_metadata WHERE ticker LIKE 'NSENG:%'`
  ).all() as { ticker: string; name: string | null }[];

  const nameByTicker = new Map<string, string | null>();
  for (const m of meta) if (m.name) nameByTicker.set(m.ticker, m.name);
  for (const w of watch) if (w.name) nameByTicker.set(w.ticker, w.name); // watchlist wins

  const tickers = new Set<string>([...held.map(h => h.ticker), ...watch.map(w => w.ticker)]);
  return [...tickers].map(ticker => ({ ticker, name: nameByTicker.get(ticker) ?? null }));
}

/** Run `fn` over `items` with at most `n` in flight (bounds cold TradingView pulls). */
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * Price + momentum snapshot for every NGX holding / watchlist name, sorted by
 * 3-month momentum (best first; names without enough history sink to the end).
 * The freshest close and day-change come from the price service (which warms the
 * cache); the trailing returns and MAs come from the cached candle history.
 */
export async function getNgxSummaries(): Promise<NgxSummary[]> {
  const list = ngxTickers();
  if (list.length === 0) return [];

  const tickers = list.map(l => l.ticker);
  const quotes = await getMultipleCurrentPrices(tickers);
  const quoteByTicker = new Map(quotes.map(q => [q.ticker, q]));

  // Refresh news + fundamentals caches if stale (both best-effort — neither
  // blocks the price/momentum data), then read them back per ticker.
  await Promise.allSettled([
    refreshNgxNews(),
    refreshNgxFundamentals(tickers),
  ]);
  const newsByTicker = getNgxNewsByTicker(list);
  const fundamentals = getNgxFundamentals(tickers);

  const to = new Date();
  const from = new Date(to.getTime() - HISTORY_DAYS * 86400000);

  const summaries = await mapPool(list, 6, async ({ ticker, name }): Promise<NgxSummary> => {
    let closes: number[] = [];
    let lastDate: string | null = null;
    try {
      const rows = await getHistoricalPrices(ticker, from, to);
      closes = rows.map(r => r.close).filter((c): c is number => typeof c === 'number' && c > 0);
      lastDate = rows.length ? rows[rows.length - 1].date : null;
    } catch {
      // Leave closes empty — momentum will be null, card still shows the quote.
    }

    const q = quoteByTicker.get(ticker);
    const m50 = sma(closes, 50);
    const m200 = sma(closes, 200);
    const last = q?.price ?? (closes.length ? closes[closes.length - 1] : null);
    const f = fundamentals.get(ticker);

    return {
      ticker,
      name,
      date: lastDate,
      close: last,
      previous_close: q?.previousClose ?? null,
      change_pct: q?.changePct ?? null,
      currency: q?.currency ?? 'NGN',
      ret_5d: retDaysAgo(closes, W5),
      ret_1m: retDaysAgo(closes, W1M),
      ret_3m: retDaysAgo(closes, W3M),
      ret_6m: retDaysAgo(closes, W6M),
      ret_1y: retDaysAgo(closes, W1Y),
      ext50: m50 != null && last != null ? last / m50 - 1 : null,
      above_200d: m200 != null && last != null ? last > m200 : null,
      pe: f?.pe ?? null,
      pb: f?.pb ?? null,
      eps: f?.eps ?? null,
      market_cap: f?.market_cap ?? null,
      dividend_yield: f?.dividend_yield ?? null,
      net_margin: f?.net_margin ?? null,
      news: newsByTicker.get(ticker) ?? [],
      stale: q?.stale ?? closes.length === 0,
      warning: q?.warning,
    };
  });

  summaries.sort((a, b) => (b.ret_3m ?? -Infinity) - (a.ret_3m ?? -Infinity));
  return summaries;
}
