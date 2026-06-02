import db from '@/lib/db';
import YahooFinance from 'yahoo-finance2';
import { getTickersToSummarize } from './summaries';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

interface NewsArticle {
  source: 'yahoo';
  title: string;
  url: string;
  publisher: string;
  published_at: string;
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
  } catch {
    return [];
  }
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

async function processTicker(ticker: string, today: string): Promise<boolean> {
  if (ticker.startsWith('NSENG:')) return false;

  try {
    const quote = await yahooFinance.quote(ticker);
    const price = quote.regularMarketPrice;
    if (price == null) return false;

    const news = await fetchYahooNews(ticker);

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
      JSON.stringify(news),
    );
    return true;
  } catch {
    return false;
  }
}

export async function collectDailySummaries(): Promise<{ total: number; success: number; date: string }> {
  const today = new Date().toISOString().split('T')[0];
  const tickers = getTickersToSummarize();

  let success = 0;
  for (const ticker of tickers) {
    const ok = await processTicker(ticker, today);
    if (ok) success++;
    await new Promise(r => setTimeout(r, 500));
  }

  return { total: tickers.length, success, date: today };
}
