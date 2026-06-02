import YahooFinance from 'yahoo-finance2';
import db from '@/lib/db';
import type { PriceData, TickerMetadata } from '@/lib/types';

const yahooFinance = new YahooFinance();

const CACHE_STALENESS_MS = 15 * 60 * 1000; // 15 minutes

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

function isCacheStale(fetchedAt: string): boolean {
  const fetchedTime = new Date(fetchedAt + 'Z').getTime();
  return Date.now() - fetchedTime > CACHE_STALENESS_MS;
}

function upsertPriceCache(ticker: string, date: string, data: {
  open?: number | null; high?: number | null; low?: number | null;
  close: number; previous_close?: number | null; change?: number | null; change_pct?: number | null;
  currency: string;
}) {
  db.prepare(
    `INSERT INTO price_cache (ticker, date, open, high, low, close, previous_close, change, change_pct, currency, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ticker, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, previous_close = excluded.previous_close,
       change = excluded.change, change_pct = excluded.change_pct,
       currency = excluded.currency, fetched_at = datetime('now')`
  ).run(ticker, date, data.open ?? null, data.high ?? null, data.low ?? null, data.close,
    data.previous_close ?? null, data.change ?? null, data.change_pct ?? null, data.currency);
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

async function fetchNgxCurrentPrice(ticker: string): Promise<{ close: number; currency: string } | null> {
  // Stub for NGX prices — returns cached price or null
  // TradingView integration or web scraping can be added later
  const symbol = ticker.startsWith('NSENG:') ? ticker : `NSENG:${ticker}`;
  const cached = db.prepare(
    'SELECT close, currency FROM price_cache WHERE ticker = ? ORDER BY date DESC LIMIT 1'
  ).get(symbol) as { close: number; currency: string } | undefined;

  if (cached) return cached;

  console.warn(`[PriceService] NGX price not available for ${ticker}. Add manually to price_cache.`);
  return null;
}

// --- Public API ---

export interface CurrentPriceResult {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string;
  stale: boolean;
  warning?: string;
}

export async function getCurrentPrice(ticker: string): Promise<CurrentPriceResult> {
  const today = new Date().toISOString().split('T')[0];

  // Check cache first
  const cached = getCachedPrice(ticker, today);
  if (cached && !isCacheStale(cached.fetched_at)) {
    return { ticker, price: cached.close, previousClose: cached.previous_close, change: cached.change, changePct: cached.change_pct, currency: cached.currency, stale: false };
  }

  // NGX ticker
  if (isNgxTicker(ticker)) {
    await ensureMetadata(ticker);
    const ngxPrice = await fetchNgxCurrentPrice(ticker);
    if (ngxPrice) {
      upsertPriceCache(ticker, today, { close: ngxPrice.close, currency: 'NGN' });
      return { ticker, price: ngxPrice.close, previousClose: null, change: null, changePct: null, currency: 'NGN', stale: false };
    }
    if (cached) {
      return { ticker, price: cached.close, previousClose: null, change: null, changePct: null, currency: cached.currency, stale: true, warning: 'Using stale cached price' };
    }
    return { ticker, price: null, previousClose: null, change: null, changePct: null, currency: 'NGN', stale: false, warning: 'No price available for NGX ticker' };
  }

  // Yahoo Finance
  try {
    await ensureMetadata(ticker);
    const quote = await yahooFinance.quote(yahooSymbol(ticker));
    const price = quote.regularMarketPrice;
    const currency = quote.currency || 'USD';

    const previousClose = quote.regularMarketPreviousClose ?? null;
    const change = quote.regularMarketChange ?? null;
    const changePct = quote.regularMarketChangePercent ?? null;

    if (price != null) {
      upsertPriceCache(ticker, today, {
        open: quote.regularMarketOpen ?? null,
        high: quote.regularMarketDayHigh ?? null,
        low: quote.regularMarketDayLow ?? null,
        close: price,
        previous_close: previousClose,
        change,
        change_pct: changePct,
        currency,
      });
      return { ticker, price, previousClose, change, changePct, currency, stale: false };
    }

    // Fallback to stale cache
    if (cached) {
      return { ticker, price: cached.close, previousClose: null, change: null, changePct: null, currency: cached.currency, stale: true, warning: 'Yahoo returned no price, using stale cache' };
    }
    return { ticker, price: null, previousClose: null, change: null, changePct: null, currency, stale: false, warning: 'No price data available' };
  } catch (err) {
    console.error(`[PriceService] Error fetching ${ticker}:`, err);
    if (cached) {
      return { ticker, price: cached.close, previousClose: null, change: null, changePct: null, currency: cached.currency, stale: true, warning: 'Fetch failed, using stale cache' };
    }
    return { ticker, price: null, previousClose: null, change: null, changePct: null, currency: 'USD', stale: false, warning: `Fetch error: ${(err as Error).message}` };
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

  // If we have some cached data, return it (historical data is cached permanently)
  if (cachedRows.length > 0) {
    return cachedRows;
  }

  if (isNgxTicker(ticker)) {
    // NGX historical data not available via stub
    console.warn(`[PriceService] No historical data for NGX ticker ${ticker}`);
    return [];
  }

  // Fetch from Yahoo Finance
  try {
    const history = await yahooFinance.historical(yahooSymbol(ticker), {
      period1: from,
      period2: to,
    });

    // Get currency from metadata or quote
    let currency = 'USD';
    const meta = db.prepare('SELECT currency FROM ticker_metadata WHERE ticker = ?').get(ticker) as { currency: string } | undefined;
    if (meta?.currency) {
      currency = meta.currency;
    }

    const rows: HistoricalPriceRow[] = [];

    const insertBatch = db.transaction(() => {
      for (const row of history) {
        const dateStr = row.date.toISOString().split('T')[0];
        upsertPriceCache(ticker, dateStr, {
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          currency,
        });
        rows.push({
          date: dateStr,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          currency,
        });
      }
    });
    insertBatch();

    return rows;
  } catch (err) {
    console.error(`[PriceService] Error fetching historical for ${ticker}:`, err);
    return cachedRows; // Return whatever we have cached
  }
}

export async function getMultipleCurrentPrices(tickers: string[]): Promise<CurrentPriceResult[]> {
  return Promise.all(tickers.map(getCurrentPrice));
}
