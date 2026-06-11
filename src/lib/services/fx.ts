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
  // SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS"; make it ISO so all engines parse it
  const fetchedTime = new Date(fetchedAt.replace(' ', 'T') + 'Z').getTime();
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

/**
 * Try to fetch an unmapped pair directly from Yahoo (FROMTO=X), falling back
 * to the inverse symbol (TOFROM=X). Returns null if neither resolves.
 * This replaces the old cross-rate fallback that recursed infinitely for any
 * pair already involving USD (e.g. GBPUSD).
 */
async function fetchDirectRate(from: string, to: string): Promise<number | null> {
  const candidates: [string, boolean][] = [
    [`${from}${to}=X`, false],
    [`${to}${from}=X`, true],
  ];
  for (const [symbol, invert] of candidates) {
    try {
      const quote = await yahooFinance.quote(symbol);
      const price = quote.regularMarketPrice;
      if (price != null && price > 0) {
        return invert ? 1 / price : price;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
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
    // 1) Try the pair directly on Yahoo (covers GBPUSD etc. — and never recurses)
    const direct = await fetchDirectRate(from, to);
    if (direct != null) {
      upsertFxCache(pair, today, direct);
      return { pair, rate: direct, stale: false };
    }

    // 2) Cross via USD — only when neither side is USD, so each leg has USD
    // on one side and resolves via the direct fetch above (bounded depth)
    if (from !== 'USD' && to !== 'USD') {
      try {
        const toUsd = await getRate(from, 'USD');
        const fromUsd = await getRate('USD', to);
        if (!toUsd.warning && !fromUsd.warning) {
          const crossRate = toUsd.rate * fromUsd.rate;
          upsertFxCache(pair, today, crossRate);
          return { pair, rate: crossRate, stale: toUsd.stale || fromUsd.stale };
        }
      } catch {
        // fall through to cache/error below
      }
    }

    if (cached) {
      return { pair, rate: cached.rate, stale: true, warning: 'Live rate unavailable, using stale cache' };
    }
    console.error(`[FXService] No rate available for ${pair} — falling back to 1:1, conversions will be wrong`);
    return { pair, rate: 1, stale: false, warning: `Unsupported FX pair: ${pair}` };
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
  // Yahoo reports LSE prices in pence as 'GBp' (or 'GBX') — scale to pounds.
  // Case-sensitive check: 'GBP' proper means pounds.
  let fromCcy = from;
  let scaledAmount = amount;
  if (from === 'GBp' || from.toUpperCase() === 'GBX') {
    fromCcy = 'GBP';
    scaledAmount = amount / 100;
  }
  let toCcy = to;
  let outScale = 1;
  if (to === 'GBp' || to.toUpperCase() === 'GBX') {
    toCcy = 'GBP';
    outScale = 100;
  }

  if (fromCcy.toUpperCase() === toCcy.toUpperCase()) return scaledAmount * outScale;
  const { rate } = await getRate(fromCcy, toCcy);
  return scaledAmount * rate * outScale;
}

async function fetchHistoricalClose(yahooSymbol: string, date: string): Promise<number | null> {
  try {
    const dateObj = new Date(date);
    const nextDay = new Date(dateObj);
    nextDay.setDate(nextDay.getDate() + 3); // buffer for weekends

    const history = await yahooFinance.historical(yahooSymbol, {
      period1: dateObj,
      period2: nextDay,
    });

    if (history.length > 0) return history[0].close;
  } catch (err) {
    console.error(`[FXService] Error fetching historical ${yahooSymbol} for ${date}:`, err);
  }
  return null;
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
    // Try the pair (and its inverse) directly, then cross via USD — but only
    // recurse when neither side is USD, so the depth is bounded
    const directSymbols: [string, boolean][] = [
      [`${pair}=X`, false],
      [`${to}${from}=X`, true],
    ];
    for (const [symbol, invert] of directSymbols) {
      const direct = await fetchHistoricalClose(symbol, date);
      if (direct != null && direct > 0) {
        const rate = invert ? 1 / direct : direct;
        upsertFxCache(pair, date, rate);
        return rate;
      }
    }

    if (from !== 'USD' && to !== 'USD') {
      const toUsd = await getHistoricalRate(from, 'USD', date);
      const fromUsd = await getHistoricalRate('USD', to, date);
      const crossRate = toUsd * fromUsd;
      upsertFxCache(pair, date, crossRate);
      return crossRate;
    }

    // No direct rate and one side is already USD — fall back to latest cache
    const latestUnmapped = db.prepare(
      'SELECT rate FROM fx_cache WHERE pair = ? ORDER BY date DESC LIMIT 1'
    ).get(pair) as { rate: number } | undefined;
    if (latestUnmapped) return latestUnmapped.rate;
    console.error(`[FXService] No historical rate for ${pair} on ${date} — falling back to 1:1`);
    return 1;
  }

  const needsInverse = INVERSE_PAIRS.has(pair);

  const close = await fetchHistoricalClose(yahooSymbol, date);
  if (close != null && close > 0) {
    const rate = needsInverse ? 1 / close : close;
    upsertFxCache(pair, date, rate);
    return rate;
  }

  // Fallback: use latest cached rate for this pair
  const latest = db.prepare(
    'SELECT rate FROM fx_cache WHERE pair = ? ORDER BY date DESC LIMIT 1'
  ).get(pair) as { rate: number } | undefined;

  return latest?.rate ?? 1;
}
