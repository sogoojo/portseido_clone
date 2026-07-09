import YahooFinance from 'yahoo-finance2';
import db from '@/lib/db';
import type { TickerOption, TickerSearchResult } from '@/lib/types';

const yahooFinance = new YahooFinance();

// The universe of tickers the picker can offer: everything we've ever seen
// metadata for, plus the watchlist, plus tickers already traded, plus
// rebalance targets. Names/currency/market come from metadata when known,
// falling back to the watchlist name. `held` flags tickers that appear in a
// buy/sell so the form can surface owned positions first (handy for sells).
export function getKnownTickers(): TickerOption[] {
  const rows = db
    .prepare(
      `WITH known AS (
         SELECT ticker FROM ticker_metadata WHERE ticker IS NOT NULL AND ticker != ''
         UNION
         SELECT ticker FROM watchlist WHERE ticker IS NOT NULL AND ticker != ''
         UNION
         SELECT DISTINCT ticker FROM transactions WHERE ticker IS NOT NULL AND ticker != ''
         UNION
         SELECT ticker FROM targets WHERE ticker IS NOT NULL AND ticker != ''
       )
       SELECT
         k.ticker AS ticker,
         COALESCE(m.name, w.name) AS name,
         m.market AS market,
         m.currency AS currency,
         EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.ticker = k.ticker AND t.type IN ('buy', 'sell')
         ) AS held
       FROM known k
       LEFT JOIN ticker_metadata m ON m.ticker = k.ticker
       LEFT JOIN watchlist w ON w.ticker = k.ticker
       ORDER BY held DESC, k.ticker ASC`
    )
    .all() as Array<Omit<TickerOption, 'held'> & { held: number }>;

  return rows.map((r) => ({ ...r, held: !!r.held }));
}

// Live symbol lookup so the picker can add instruments the app has never seen
// (e.g. QDVE → QDVE.DE) without the user knowing Yahoo's exchange-suffix rules.
// `validateResult: false` is REQUIRED — the library's strict schema throws on
// some rows (e.g. QDVE fails #/definitions/SearchResult). No NGX coverage.
export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const res = (await yahooFinance.search(
    q,
    { quotesCount: 10, newsCount: 0, enableFuzzyQuery: false },
    { validateResult: false }
  )) as { quotes?: Array<Record<string, unknown>> };

  const quotes = res?.quotes ?? [];
  return quotes
    .filter((row) => typeof row.symbol === 'string' && row.symbol)
    .map((row) => ({
      symbol: row.symbol as string,
      name:
        (row.shortname as string) ||
        (row.longname as string) ||
        (row.shortName as string) ||
        null,
      exchange: (row.exchDisp as string) || (row.exchange as string) || null,
      quoteType: (row.quoteType as string) || (row.typeDisp as string) || null,
      currency: (row.currency as string) || null,
    }));
}
