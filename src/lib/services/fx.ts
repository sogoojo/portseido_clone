import YahooFinance from 'yahoo-finance2';
import db from '@/lib/db';
import type { FXRate } from '@/lib/types';

const yahooFinance = new YahooFinance();

const CACHE_STALENESS_MS = 15 * 60 * 1000; // 15 minutes

// Yahoo Finance FX symbols
const FX_SYMBOLS: Record<string, string> = {
  EURUSD: 'EURUSD=X',
  USDEUR: 'EURUSD=X', // inverse
  NGNUSD: 'NGNUSD=X',
  USDNGN: 'NGNUSD=X', // inverse
  NGNEUR: 'NGNEUR=X',
  EURNGN: 'NGNEUR=X', // inverse
};

// Which pairs need to be inverted when using the Yahoo symbol
const INVERSE_PAIRS = new Set(['USDEUR', 'USDNGN', 'EURNGN']);

function getCachedRate(pair: string, date: string): FXRate | null {
  const row = db.prepare(
    'SELECT * FROM fx_cache WHERE pair = ? AND date = ?'
  ).get(pair, date) as FXRate | undefined;
  return row || null;
}

function isCacheStale(fetchedAt: string): boolean {
  const fetchedTime = new Date(fetchedAt + 'Z').getTime();
  return Date.now() - fetchedTime > CACHE_STALENESS_MS;
}

function upsertFxCache(pair: string, date: string, rate: number) {
  db.prepare(
    `INSERT INTO fx_cache (pair, date, rate, fetched_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(pair, date) DO UPDATE SET
       rate = excluded.rate, fetched_at = datetime('now')`
  ).run(pair, date, rate);
}

function normalizePair(from: string, to: string): string {
  return `${from.toUpperCase()}${to.toUpperCase()}`;
}

export interface FXRateResult {
  pair: string;
  rate: number;
  stale: boolean;
  warning?: string;
}

export async function getRate(from: string, to: string): Promise<FXRateResult> {
  from = from.toUpperCase();
  to = to.toUpperCase();

  // Same currency
  if (from === to) {
    return { pair: `${from}${to}`, rate: 1, stale: false };
  }

  const pair = normalizePair(from, to);
  const today = new Date().toISOString().split('T')[0];

  // Check cache
  const cached = getCachedRate(pair, today);
  if (cached && !isCacheStale(cached.fetched_at)) {
    return { pair, rate: cached.rate, stale: false };
  }

  // Find the Yahoo symbol
  const yahooSymbol = FX_SYMBOLS[pair];
  if (!yahooSymbol) {
    // Try to derive via USD cross rate
    // e.g., NGNEUR = NGNUSD * USDEUR
    try {
      const toUsd = await getRate(from, 'USD');
      const fromUsd = await getRate('USD', to);
      const crossRate = toUsd.rate * fromUsd.rate;
      upsertFxCache(pair, today, crossRate);
      return { pair, rate: crossRate, stale: toUsd.stale || fromUsd.stale };
    } catch {
      if (cached) {
        return { pair, rate: cached.rate, stale: true, warning: 'Cross rate failed, using stale cache' };
      }
      return { pair, rate: 1, stale: false, warning: `Unsupported FX pair: ${pair}` };
    }
  }

  const needsInverse = INVERSE_PAIRS.has(pair);

  try {
    const quote = await yahooFinance.quote(yahooSymbol);
    let rate = quote.regularMarketPrice;

    if (rate == null) {
      if (cached) {
        return { pair, rate: cached.rate, stale: true, warning: 'Yahoo returned no rate, using stale cache' };
      }
      return { pair, rate: 1, stale: false, warning: 'No FX rate available' };
    }

    if (needsInverse) {
      rate = 1 / rate;
    }

    upsertFxCache(pair, today, rate);
    return { pair, rate, stale: false };
  } catch (err) {
    console.error(`[FXService] Error fetching ${pair}:`, err);
    if (cached) {
      return { pair, rate: cached.rate, stale: true, warning: 'Fetch failed, using stale cache' };
    }
    return { pair, rate: 1, stale: false, warning: `FX fetch error: ${(err as Error).message}` };
  }
}

export async function convert(amount: number, from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  const { rate } = await getRate(from, to);
  return amount * rate;
}

export async function getHistoricalRate(from: string, to: string, date: string): Promise<number> {
  from = from.toUpperCase();
  to = to.toUpperCase();
  if (from === to) return 1;

  const pair = normalizePair(from, to);

  // Check cache
  const cached = getCachedRate(pair, date);
  if (cached) return cached.rate;

  // For historical, we try to get it from Yahoo
  const yahooSymbol = FX_SYMBOLS[pair];
  if (!yahooSymbol) {
    // Cross rate
    const toUsd = await getHistoricalRate(from, 'USD', date);
    const fromUsd = await getHistoricalRate('USD', to, date);
    const crossRate = toUsd * fromUsd;
    upsertFxCache(pair, date, crossRate);
    return crossRate;
  }

  const needsInverse = INVERSE_PAIRS.has(pair);

  try {
    const yahooFin = new YahooFinance();
    const dateObj = new Date(date);
    const nextDay = new Date(dateObj);
    nextDay.setDate(nextDay.getDate() + 3); // buffer for weekends

    const history = await yahooFin.historical(yahooSymbol, {
      period1: dateObj,
      period2: nextDay,
    });

    if (history.length > 0) {
      let rate = history[0].close;
      if (needsInverse) rate = 1 / rate;
      upsertFxCache(pair, date, rate);
      return rate;
    }
  } catch (err) {
    console.error(`[FXService] Error fetching historical ${pair} for ${date}:`, err);
  }

  // Fallback: use latest cached rate for this pair
  const latest = db.prepare(
    'SELECT rate FROM fx_cache WHERE pair = ? ORDER BY date DESC LIMIT 1'
  ).get(pair) as { rate: number } | undefined;

  return latest?.rate ?? 1;
}
