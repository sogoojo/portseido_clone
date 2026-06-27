import YahooFinance from 'yahoo-finance2';
import db from '@/lib/db';
import { fetchTvDailyCandles, fetchTvDailyCandlesMulti, tvSymbol, type TvDailyResult } from '@/lib/services/tradingview';
import type { PriceData, TickerMetadata } from '@/lib/types';

const yahooFinance = new YahooFinance();

const CACHE_STALENESS_MS = 15 * 60 * 1000; // 15 minutes
// NGX trades 9:00–16:00 WAT (7h session since 27 Apr 2026) but most names
// print only a handful of price changes per day — 2h keeps intraday moves
// visible without re-opening websockets for data that rarely moves
const NGX_CACHE_STALENESS_MS = 2 * 60 * 60 * 1000;

// --- Ticker routing ---

function isNgxTicker(ticker: string): boolean {
  if (ticker.startsWith('NSENG:')) return true;
  const meta = db.prepare('SELECT market FROM ticker_metadata WHERE ticker = ?').get(ticker) as { market: string } | undefined;
  return meta?.market === 'ngx';
}

function yahooSymbol(ticker: string): string {
  // Ticker is already in Yahoo format for US/EU/crypto/FX
  return ticker;
}

function ngxSymbol(ticker: string): string {
  // Strip NSENG: prefix if present
  return ticker.replace(/^NSENG:/, '');
}

// --- Cache helpers ---

function getCachedPrice(ticker: string, date: string): PriceData | null {
  const row = db.prepare(
    'SELECT * FROM price_cache WHERE ticker = ? AND date = ?'
  ).get(ticker, date) as PriceData | undefined;
  return row || null;
}

function isCacheStale(fetchedAt: string, maxAgeMs = CACHE_STALENESS_MS): boolean {
  // SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS"; make it ISO so all engines parse it
  const fetchedTime = new Date(fetchedAt.replace(' ', 'T') + 'Z').getTime();
  return Date.now() - fetchedTime > maxAgeMs;
}

function upsertPriceCache(ticker: string, date: string, data: {
  open?: number | null; high?: number | null; low?: number | null;
  close: number; previous_close?: number | null; change?: number | null; change_pct?: number | null;
  currency: string; fifty_two_week_high?: number | null; fifty_two_week_low?: number | null;
  fifty_day_avg?: number | null; two_hundred_day_avg?: number | null;
}) {
  db.prepare(
    `INSERT INTO price_cache (ticker, date, open, high, low, close, previous_close, change, change_pct, currency, fifty_two_week_high, fifty_two_week_low, fifty_day_avg, two_hundred_day_avg, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ticker, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, previous_close = excluded.previous_close,
       change = excluded.change, change_pct = excluded.change_pct,
       currency = excluded.currency, fifty_two_week_high = excluded.fifty_two_week_high,
       fifty_two_week_low = excluded.fifty_two_week_low, fifty_day_avg = excluded.fifty_day_avg,
       two_hundred_day_avg = excluded.two_hundred_day_avg,
       fetched_at = datetime('now')`
  ).run(ticker, date, data.open ?? null, data.high ?? null, data.low ?? null, data.close,
    data.previous_close ?? null, data.change ?? null, data.change_pct ?? null, data.currency,
    data.fifty_two_week_high ?? null, data.fifty_two_week_low ?? null,
    data.fifty_day_avg ?? null, data.two_hundred_day_avg ?? null);
}

// --- Metadata ---

async function ensureMetadata(ticker: string): Promise<void> {
  const existing = db.prepare('SELECT ticker FROM ticker_metadata WHERE ticker = ?').get(ticker);
  if (existing) return;

  if (isNgxTicker(ticker)) {
    // NGX tickers: insert stub metadata — sector can be added manually later
    const name = ngxSymbol(ticker);
    db.prepare(
      `INSERT OR IGNORE INTO ticker_metadata (ticker, name, asset_type, market, currency, updated_at)
       VALUES (?, ?, 'ngx_equity', 'ngx', 'NGN', datetime('now'))`
    ).run(ticker, name);
    return;
  }

  try {
    const summary = await yahooFinance.quoteSummary(yahooSymbol(ticker), { modules: ['assetProfile', 'price'] });
    const profile = summary.assetProfile;
    const price = summary.price;

    let assetType: string = 'equity';
    const quoteType = price?.quoteType?.toLowerCase();
    if (quoteType === 'cryptocurrency') assetType = 'crypto';
    else if (quoteType === 'etf') assetType = 'etf';

    let market = 'us';
    const exchange = price?.exchange?.toLowerCase() || '';
    if (['xetra', 'ger', 'fra', 'par', 'ams', 'mil', 'bru'].some(e => exchange.includes(e))) {
      market = 'eu';
    }

    db.prepare(
      `INSERT OR IGNORE INTO ticker_metadata (ticker, name, sector, industry, asset_type, market, currency, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      ticker,
      price?.shortName || price?.longName || ticker,
      profile?.sector || null,
      profile?.industry || null,
      assetType,
      market,
      price?.currency || null
    );
  } catch (err) {
    console.error(`[PriceService] Failed to fetch metadata for ${ticker}:`, err);
    // Insert minimal metadata so we don't retry every time
    db.prepare(
      `INSERT OR IGNORE INTO ticker_metadata (ticker, name, updated_at)
       VALUES (?, ?, datetime('now'))`
    ).run(ticker, ticker);
  }
}

// --- NGX stub ---

interface NgxCachedRow {
  date: string;
  close: number;
  currency: string;
  fetched_at: string;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
}

function getLatestNgxCachedPrice(ticker: string): NgxCachedRow | null {
  // Latest cached NGX row — keyed by its real trading day, which can be a few
  // days back (weekends/holidays). Callers decide freshness via fetched_at.
  const symbol = tvSymbol(ticker);
  const cached = db.prepare(
    'SELECT date, close, currency, fetched_at, previous_close, change, change_pct FROM price_cache WHERE ticker = ? ORDER BY date DESC LIMIT 1'
  ).get(symbol) as NgxCachedRow | undefined;
  return cached ?? null;
}

/** Fresh-enough cached NGX price, or null if a live fetch is warranted. */
function ngxResultFromFreshCache(ticker: string, today: string): CurrentPriceResult | null {
  const cached = getLatestNgxCachedPrice(ticker);
  if (!cached || isCacheStale(cached.fetched_at, NGX_CACHE_STALENESS_MS)) return null;
  return { ticker, price: cached.close, ...EMPTY_FIELDS, previousClose: cached.previous_close, change: cached.change, changePct: cached.change_pct, currency: cached.currency || 'NGN', stale: false, warning: cached.date !== today ? `Last NGX trading day: ${cached.date}` : undefined };
}

/** Build the result from live TradingView candles and persist them. */
function ngxResultFromTv(ticker: string, tv: TvDailyResult, today: string): CurrentPriceResult {
  const candles = tv.candles;
  const latest = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const change = prev ? latest.close - prev.close : null;
  const changePct = prev && prev.close > 0 && change != null ? (change / prev.close) * 100 : null;
  const currency = tv.currency || 'NGN';

  for (const c of candles) {
    upsertPriceCache(tvSymbol(ticker), c.date, {
      open: c.open, high: c.high, low: c.low, close: c.close,
      previous_close: c === latest ? prev?.close ?? null : null,
      change: c === latest ? change : null,
      change_pct: c === latest ? changePct : null,
      currency,
    });
  }
  return { ticker, price: latest.close, ...EMPTY_FIELDS, previousClose: prev?.close ?? null, change, changePct, currency, stale: false, warning: latest.date !== today ? `Last NGX trading day: ${latest.date}` : undefined };
}

/** TradingView unreachable — fall back to whatever is cached (no live retry). */
function ngxFallbackResult(ticker: string): CurrentPriceResult {
  const cached = getLatestNgxCachedPrice(ticker);
  if (cached) {
    return { ticker, price: cached.close, ...EMPTY_FIELDS, currency: cached.currency || 'NGN', stale: true, warning: `TradingView fetch failed, NGX price from ${cached.date}` };
  }
  return { ticker, price: null, ...EMPTY_FIELDS, currency: 'NGN', stale: false, warning: 'No price available for NGX ticker' };
}

// --- Public API ---

export interface CurrentPriceResult {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  stale: boolean;
  warning?: string;
}

const EMPTY_FIELDS = {
  previousClose: null, change: null, changePct: null,
  fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
  fiftyDayAverage: null, twoHundredDayAverage: null,
} as const;

function resultFromFreshCache(ticker: string, cached: PriceData): CurrentPriceResult {
  return { ticker, price: cached.close, previousClose: cached.previous_close, change: cached.change, changePct: cached.change_pct, currency: cached.currency, fiftyTwoWeekHigh: cached.fifty_two_week_high ?? null, fiftyTwoWeekLow: cached.fifty_two_week_low ?? null, fiftyDayAverage: cached.fifty_day_avg ?? null, twoHundredDayAverage: cached.two_hundred_day_avg ?? null, stale: false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resultFromQuote(ticker: string, quote: any, today: string): CurrentPriceResult | null {
  const price = quote.regularMarketPrice;
  if (price == null) return null;
  const currency = quote.currency || 'USD';

  const previousClose = quote.regularMarketPreviousClose ?? null;
  const change = quote.regularMarketChange ?? null;
  const changePct = quote.regularMarketChangePercent ?? null;
  const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh ?? null;
  const fiftyTwoWeekLow = quote.fiftyTwoWeekLow ?? null;
  const fiftyDayAverage = quote.fiftyDayAverage ?? null;
  const twoHundredDayAverage = quote.twoHundredDayAverage ?? null;

  upsertPriceCache(ticker, today, {
    open: quote.regularMarketOpen ?? null,
    high: quote.regularMarketDayHigh ?? null,
    low: quote.regularMarketDayLow ?? null,
    close: price,
    previous_close: previousClose,
    change,
    change_pct: changePct,
    currency,
    fifty_two_week_high: fiftyTwoWeekHigh,
    fifty_two_week_low: fiftyTwoWeekLow,
    fifty_day_avg: fiftyDayAverage,
    two_hundred_day_avg: twoHundredDayAverage,
  });
  return { ticker, price, previousClose, change, changePct, currency, fiftyTwoWeekHigh, fiftyTwoWeekLow, fiftyDayAverage, twoHundredDayAverage, stale: false };
}

export async function getCurrentPrice(ticker: string): Promise<CurrentPriceResult> {
  const today = new Date().toISOString().split('T')[0];

  // Check cache first
  const cached = getCachedPrice(ticker, today);
  if (cached && !isCacheStale(cached.fetched_at)) {
    return resultFromFreshCache(ticker, cached);
  }

  // NGX ticker — live daily candles via TradingView
  if (isNgxTicker(ticker)) {
    await ensureMetadata(ticker);

    const fresh = ngxResultFromFreshCache(ticker, today);
    if (fresh) return fresh;

    const tv = await fetchTvDailyCandles(tvSymbol(ticker), 3);
    if (tv) return ngxResultFromTv(ticker, tv, today);
    return ngxFallbackResult(ticker);
  }

  // Yahoo Finance
  try {
    await ensureMetadata(ticker);
    const quote = await yahooFinance.quote(yahooSymbol(ticker));
    const result = resultFromQuote(ticker, quote, today);
    if (result) return result;

    // Fallback to stale cache
    if (cached) {
      return { ticker, price: cached.close, ...EMPTY_FIELDS, currency: cached.currency, stale: true, warning: 'Yahoo returned no price, using stale cache' };
    }
    return { ticker, price: null, ...EMPTY_FIELDS, currency: quote.currency || 'USD', stale: false, warning: 'No price data available' };
  } catch (err) {
    console.error(`[PriceService] Error fetching ${ticker}:`, err);
    if (cached) {
      return { ticker, price: cached.close, ...EMPTY_FIELDS, currency: cached.currency, stale: true, warning: 'Fetch failed, using stale cache' };
    }
    return { ticker, price: null, ...EMPTY_FIELDS, currency: 'USD', stale: false, warning: `Fetch error: ${(err as Error).message}` };
  }
}

export interface HistoricalPriceRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  currency: string;
}

export async function getHistoricalPrices(ticker: string, from: Date, to: Date): Promise<HistoricalPriceRow[]> {
  // Check if we have cached data for the range
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  const cachedRows = db.prepare(
    'SELECT date, open, high, low, close, currency FROM price_cache WHERE ticker = ? AND date >= ? AND date <= ? ORDER BY date'
  ).all(ticker, fromStr, toStr) as HistoricalPriceRow[];

  // Trust the cache only if it actually covers the requested range. A single
  // row (e.g. today's quote, written by getCurrentPrice into the same table)
  // must not short-circuit a 1Y fetch.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  if (cachedRows.length > 0) {
    const startGapDays = (Date.parse(cachedRows[0].date) - Date.parse(fromStr)) / DAY_MS;
    const endGapDays = (Date.parse(toStr) - Date.parse(cachedRows[cachedRows.length - 1].date)) / DAY_MS;
    // ~0.68 of calendar days are trading days; 0.4 leaves margin for holidays
    const denseEnough = spanDays <= 7 || cachedRows.length >= Math.floor(spanDays * 0.4);
    if (startGapDays <= 7 && endGapDays <= 7 && denseEnough) {
      return cachedRows;
    }
  }

  // NGX: daily candles from TradingView (cached permanently like Yahoo data)
  if (isNgxTicker(ticker)) {
    const bars = Math.min(spanDays + 10, 1500);
    const tv = await fetchTvDailyCandles(tvSymbol(ticker), bars, 20000);
    if (tv) {
      const currency = tv.currency || 'NGN';
      const todayStr = new Date().toISOString().split('T')[0];
      const hasTodayQuote = !!getCachedPrice(tvSymbol(ticker), todayStr);

      const insertBatch = db.transaction(() => {
        for (const c of tv.candles) {
          // today's quote row carries change fields the candle feed lacks
          if (c.date === todayStr && hasTodayQuote) continue;
          upsertPriceCache(tvSymbol(ticker), c.date, {
            open: c.open, high: c.high, low: c.low, close: c.close, currency,
          });
        }
      });
      insertBatch();

      return tv.candles
        .filter(c => c.date >= fromStr && c.date <= toStr)
        .map(c => ({ date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, currency }));
    }

    if (cachedRows.length === 0) console.warn(`[PriceService] No historical data for NGX ticker ${ticker}`);
    return cachedRows;
  }

  // Fetch from Yahoo Finance. Use chart() rather than the deprecated
  // historical(): the latter throws ("SOME (but not all) null values") on any
  // Yahoo response containing gap rows, which silently broke all backfill.
  try {
    const chart = await yahooFinance.chart(yahooSymbol(ticker), {
      period1: from,
      period2: to,
      interval: '1d',
    });
    // Drop gap rows (holidays/halts) that carry a null close.
    const quotes = (chart?.quotes ?? []).filter((q) => q.date && q.close != null);

    // Get currency from metadata, falling back to the chart's own meta
    let currency = 'USD';
    const meta = db.prepare('SELECT currency FROM ticker_metadata WHERE ticker = ?').get(ticker) as { currency: string } | undefined;
    if (meta?.currency) {
      currency = meta.currency;
    } else if (chart?.meta?.currency) {
      currency = chart.meta.currency;
    }

    const rows: HistoricalPriceRow[] = [];

    const todayStr = new Date().toISOString().split('T')[0];
    const hasTodayQuote = !!getCachedPrice(ticker, todayStr);

    const insertBatch = db.transaction(() => {
      for (const row of quotes) {
        const dateStr = row.date.toISOString().split('T')[0];
        // Don't clobber today's quote row — it carries change/52wk fields the
        // historical feed lacks, and the upsert would null them out
        if (!(dateStr === todayStr && hasTodayQuote)) {
          upsertPriceCache(ticker, dateStr, {
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close as number,
            currency,
          });
        }
        rows.push({
          date: dateStr,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close as number,
          currency,
        });
      }
    });
    insertBatch();

    return rows.length > 0 ? rows : cachedRows;
  } catch (err) {
    console.error(`[PriceService] Error fetching historical for ${ticker}:`, err);
    return cachedRows; // Return whatever we have cached
  }
}

export async function getMultipleCurrentPrices(tickers: string[]): Promise<CurrentPriceResult[]> {
  const today = new Date().toISOString().split('T')[0];
  const results = new Map<string, CurrentPriceResult>();
  const toBatch: string[] = [];
  const ngxToFetch: string[] = [];

  for (const ticker of tickers) {
    const cached = getCachedPrice(ticker, today);
    if (cached && !isCacheStale(cached.fetched_at)) {
      results.set(ticker, resultFromFreshCache(ticker, cached));
    } else if (isNgxTicker(ticker)) {
      const fresh = ngxResultFromFreshCache(ticker, today);
      if (fresh) results.set(ticker, fresh);
      else ngxToFetch.push(ticker);
    } else {
      toBatch.push(ticker);
    }
  }

  // NGX: one websocket connection for all symbols. No per-ticker retry on
  // failure — that would stack 12s timeouts per ticker when TradingView is down
  if (ngxToFetch.length > 0) {
    await Promise.all(ngxToFetch.map(ensureMetadata));
    const tvResults = await fetchTvDailyCandlesMulti(ngxToFetch.map(tvSymbol), 3);
    for (const ticker of ngxToFetch) {
      const tv = tvResults.get(tvSymbol(ticker));
      results.set(ticker, tv ? ngxResultFromTv(ticker, tv, today) : ngxFallbackResult(ticker));
    }
  }

  // One Yahoo request for all uncached tickers instead of N sequential quotes
  if (toBatch.length > 0) {
    try {
      await Promise.all(toBatch.map(ensureMetadata));
      const quotes = await yahooFinance.quote(toBatch.map(yahooSymbol));
      const quoteList = Array.isArray(quotes) ? quotes : [quotes];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bySymbol = new Map(quoteList.map((q: any) => [q.symbol, q]));
      for (const ticker of toBatch) {
        const quote = bySymbol.get(yahooSymbol(ticker));
        const result = quote ? resultFromQuote(ticker, quote, today) : null;
        if (result) results.set(ticker, result);
      }
    } catch (err) {
      console.error('[PriceService] Batch quote failed, falling back to per-ticker:', err);
    }
    // Anything the batch didn't resolve goes through the per-ticker path,
    // which has the stale-cache fallbacks
    for (const ticker of toBatch) {
      if (!results.has(ticker)) {
        results.set(ticker, await getCurrentPrice(ticker));
      }
    }
  }

  return tickers.map(t => results.get(t)!);
}
