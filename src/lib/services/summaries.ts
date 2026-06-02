import db from '@/lib/db';
import YahooFinance from 'yahoo-finance2';
import type { DailySummary, WatchlistItem, NewsArticle } from '@/lib/types';

const yahooFinance = new YahooFinance();

interface SummaryRow {
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
  currency: string;
  news: string | null;
  fetched_at: string;
}

function rowToSummary(row: SummaryRow): DailySummary {
  let news: NewsArticle[] = [];
  if (row.news) {
    try { news = JSON.parse(row.news); } catch { /* malformed JSON */ }
  }
  return { ...row, news };
}

export function getSummaryForDate(ticker: string, date: string): DailySummary | null {
  const row = db.prepare(
    'SELECT * FROM daily_summaries WHERE ticker = ? AND date = ?'
  ).get(ticker, date) as SummaryRow | undefined;
  return row ? rowToSummary(row) : null;
}

export function getLatestSummaries(tickers?: string[]): DailySummary[] {
  if (tickers && tickers.length > 0) {
    const placeholders = tickers.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT ds.* FROM daily_summaries ds
      INNER JOIN (
        SELECT ticker, MAX(date) as max_date
        FROM daily_summaries
        WHERE ticker IN (${placeholders})
        GROUP BY ticker
      ) latest ON ds.ticker = latest.ticker AND ds.date = latest.max_date
      ORDER BY ds.ticker
    `).all(...tickers) as SummaryRow[];
    return rows.map(rowToSummary);
  }

  const rows = db.prepare(`
    SELECT ds.* FROM daily_summaries ds
    INNER JOIN (
      SELECT ticker, MAX(date) as max_date
      FROM daily_summaries
      GROUP BY ticker
    ) latest ON ds.ticker = latest.ticker AND ds.date = latest.max_date
    ORDER BY ds.ticker
  `).all() as SummaryRow[];
  return rows.map(rowToSummary);
}

export function getSummaries(options: {
  ticker?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}): { summaries: DailySummary[]; total: number } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.ticker) {
    conditions.push('ticker = ?');
    params.push(options.ticker);
  }
  if (options.from) {
    conditions.push('date >= ?');
    params.push(options.from);
  }
  if (options.to) {
    conditions.push('date <= ?');
    params.push(options.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(
    `SELECT COUNT(*) as cnt FROM daily_summaries ${where}`
  ).get(...params) as { cnt: number }).cnt;

  const rows = db.prepare(
    `SELECT * FROM daily_summaries ${where} ORDER BY date DESC, ticker LIMIT ? OFFSET ?`
  ).all(...params, options.limit, options.offset) as SummaryRow[];

  return { summaries: rows.map(rowToSummary), total };
}

// --- Watchlist ---

export function getWatchlist(): WatchlistItem[] {
  return db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC').all() as WatchlistItem[];
}

export function addToWatchlist(ticker: string, name?: string): WatchlistItem {
  db.prepare(
    'INSERT OR IGNORE INTO watchlist (ticker, name) VALUES (?, ?)'
  ).run(ticker, name ?? null);
  return db.prepare('SELECT * FROM watchlist WHERE ticker = ?').get(ticker) as WatchlistItem;
}

export function removeFromWatchlist(ticker: string): void {
  db.prepare('DELETE FROM watchlist WHERE ticker = ?').run(ticker);
}

// --- Daily summary runner ---

async function fetchYahooNews(ticker: string): Promise<NewsArticle[]> {
  try {
    const result = await yahooFinance.search(ticker, { newsCount: 5, quotesCount: 0 });
    if (!result.news) return [];
    return result.news
      .filter(n => {
        const publishTime = new Date(n.providerPublishTime).getTime();
        return Date.now() - publishTime < 48 * 60 * 60 * 1000;
      })
      .map(n => ({
        source: 'yahoo' as const,
        title: n.title,
        url: n.link,
        publisher: n.publisher,
        published_at: new Date(n.providerPublishTime).toISOString(),
      }));
  } catch {
    return [];
  }
}

async function fetchBraveNews(ticker: string, companyName?: string): Promise<NewsArticle[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  const query = companyName ? `${companyName} stock news` : `${ticker} stock news`;
  try {
    const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=5&freshness=pd`;
    const response = await fetch(url, {
      headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    });
    if (!response.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.results || []).map((r: any) => ({
      source: 'brave' as const,
      title: r.title,
      url: r.url,
      publisher: r.meta_url?.hostname || 'Unknown',
      published_at: r.age || new Date().toISOString(),
      snippet: r.description,
    }));
  } catch {
    return [];
  }
}

function deduplicateNews(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  return articles.filter(a => {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const upsertSummary = db.prepare(`
  INSERT INTO daily_summaries (ticker, date, open, high, low, close, previous_close, change, change_pct, volume, market_cap, currency, news, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(ticker, date) DO UPDATE SET
    open = excluded.open, high = excluded.high, low = excluded.low,
    close = excluded.close, previous_close = excluded.previous_close,
    change = excluded.change, change_pct = excluded.change_pct,
    volume = excluded.volume, market_cap = excluded.market_cap,
    currency = excluded.currency, news = excluded.news,
    fetched_at = datetime('now')
`);

async function processTicker(ticker: string, date: string): Promise<boolean> {
  if (ticker.startsWith('NSENG:')) return false;

  try {
    const quote = await yahooFinance.quote(ticker);
    const price = quote.regularMarketPrice;
    if (price == null) return false;

    const meta = db.prepare('SELECT name FROM ticker_metadata WHERE ticker = ?')
      .get(ticker) as { name: string } | undefined;

    const [yahooNews, braveNews] = await Promise.all([
      fetchYahooNews(ticker),
      fetchBraveNews(ticker, meta?.name || undefined),
    ]);
    const allNews = deduplicateNews([...yahooNews, ...braveNews]);

    upsertSummary.run(
      ticker, date,
      quote.regularMarketOpen ?? null,
      quote.regularMarketDayHigh ?? null,
      quote.regularMarketDayLow ?? null,
      price,
      quote.regularMarketPreviousClose ?? null,
      quote.regularMarketChange ?? null,
      quote.regularMarketChangePercent ?? null,
      quote.regularMarketVolume ?? null,
      quote.marketCap ?? null,
      quote.currency || 'USD',
      JSON.stringify(allNews),
    );
    return true;
  } catch {
    return false;
  }
}

export async function runDailySummaries(): Promise<{ date: string; success: number; total: number }> {
  const date = new Date().toISOString().split('T')[0];
  const tickers = getTickersToSummarize();
  if (tickers.length === 0) return { date, success: 0, total: 0 };

  let success = 0;
  for (const ticker of tickers) {
    const ok = await processTicker(ticker, date);
    if (ok) success++;
    await new Promise(r => setTimeout(r, 500));
  }
  return { date, success, total: tickers.length };
}

export function getTickersToSummarize(): string[] {
  const holdings = db.prepare(`
    SELECT ticker FROM (
      SELECT ticker,
        SUM(CASE WHEN type = 'buy' THEN quantity ELSE 0 END) as bought,
        SUM(CASE WHEN type = 'sell' THEN quantity ELSE 0 END) as sold
      FROM transactions
      WHERE type IN ('buy', 'sell') AND ticker IS NOT NULL
      GROUP BY ticker
    ) WHERE bought > sold + 0.0001
  `).all() as { ticker: string }[];

  const watchlist = db.prepare('SELECT ticker FROM watchlist').all() as { ticker: string }[];

  const tickers = new Set([
    ...holdings.map(h => h.ticker),
    ...watchlist.map(w => w.ticker),
  ]);
  return [...tickers];
}
