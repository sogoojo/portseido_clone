import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

interface NewsArticle {
  source: 'yahoo' | 'brave';
  title: string;
  url: string;
  publisher: string;
  published_at: string;
  snippet?: string;
}

const DB_PATH = path.join(process.cwd(), 'data', 'portseido-lite.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'schema.sql');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const today = new Date().toISOString().split('T')[0];

function getTickersToSummarize(): string[] {
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
  } catch (err) {
    console.error(`  [Yahoo News] ${ticker}: ${(err as Error).message}`);
    return [];
  }
}

async function fetchBraveNews(ticker: string, companyName?: string): Promise<NewsArticle[]> {
  if (!BRAVE_API_KEY) return [];

  const query = companyName ? `${companyName} stock news` : `${ticker} stock news`;
  try {
    const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=5&freshness=pd`;
    const response = await fetch(url, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' },
    });
    if (!response.ok) {
      console.error(`  [Brave] ${ticker}: HTTP ${response.status}`);
      return [];
    }
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
  } catch (err) {
    console.error(`  [Brave] ${ticker}: ${(err as Error).message}`);
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

const upsertStmt = db.prepare(`
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

async function processTicker(ticker: string): Promise<boolean> {
  if (ticker.startsWith('NSENG:')) {
    console.log(`  ${ticker}: skipped (NGX)`);
    return false;
  }

  try {
    const quote = await yahooFinance.quote(ticker);
    const price = quote.regularMarketPrice;
    if (price == null) {
      console.warn(`  ${ticker}: no price data, skipping`);
      return false;
    }

    const meta = db.prepare('SELECT name FROM ticker_metadata WHERE ticker = ?')
      .get(ticker) as { name: string } | undefined;

    const [yahooNews, braveNews] = await Promise.all([
      fetchYahooNews(ticker),
      fetchBraveNews(ticker, meta?.name || undefined),
    ]);

    const allNews = deduplicateNews([...yahooNews, ...braveNews]);

    upsertStmt.run(
      ticker, today,
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

    const changePct = quote.regularMarketChangePercent;
    const changeStr = changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '';
    console.log(`  ${ticker}: $${price.toFixed(2)} ${changeStr} | ${allNews.length} articles`);
    return true;
  } catch (err) {
    console.error(`  ${ticker}: ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  console.log(`\n=== Daily Summaries: ${today} ===\n`);

  const tickers = getTickersToSummarize();
  if (tickers.length === 0) {
    console.log('No tickers to process (no holdings or watchlist items).');
    db.close();
    return;
  }

  console.log(`Processing ${tickers.length} tickers...\n`);

  let success = 0;
  for (const ticker of tickers) {
    const ok = await processTicker(ticker);
    if (ok) success++;
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone. ${success}/${tickers.length} summaries stored for ${today}.`);
  db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  db.close();
  process.exit(1);
});
