import db from '@/lib/db';
import YahooFinance from 'yahoo-finance2';
import type {
  DailySummary, WatchlistItem, NewsArticle, RatingChange,
  RecTrendPoint, EarningsTrendPoint,
} from '@/lib/types';

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
  recommendation_key: string | null;
  recommendation_mean: number | null;
  analyst_count: number | null;
  target_mean: number | null;
  target_high: number | null;
  target_low: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  beta: number | null;
  short_ratio: number | null;
  fifty_two_week_change: number | null;
  earnings_surprise_pct: number | null;
  insider_net_shares: number | null;
  rating_changes: string | null;
  recommendation_trend: string | null;
  earnings_trend: string | null;
  fetched_at: string;
}

function rowToSummary(row: SummaryRow): DailySummary {
  let news: NewsArticle[] = [];
  if (row.news) {
    try { news = JSON.parse(row.news); } catch { /* malformed JSON */ }
  }
  let rating_changes: RatingChange[] = [];
  if (row.rating_changes) {
    try { rating_changes = JSON.parse(row.rating_changes); } catch { /* malformed JSON */ }
  }
  let recommendation_trend: RecTrendPoint[] = [];
  if (row.recommendation_trend) {
    try { recommendation_trend = JSON.parse(row.recommendation_trend); } catch { /* malformed JSON */ }
  }
  let earnings_trend: EarningsTrendPoint[] = [];
  if (row.earnings_trend) {
    try { earnings_trend = JSON.parse(row.earnings_trend); } catch { /* malformed JSON */ }
  }
  return { ...row, news, rating_changes, recommendation_trend, earnings_trend };
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

export function addToWatchlist(
  ticker: string,
  name?: string,
  opts?: { target_entry?: number | null; tier?: number | null; notes?: string | null }
): WatchlistItem {
  db.prepare(
    `INSERT INTO watchlist (ticker, name, target_entry, tier, notes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       name = COALESCE(excluded.name, watchlist.name),
       target_entry = excluded.target_entry,
       tier = excluded.tier,
       notes = excluded.notes`
  ).run(ticker, name ?? null, opts?.target_entry ?? null, opts?.tier ?? null, opts?.notes ?? null);
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

// Free structured analyst/fundamental signals from yahoo-finance2 quoteSummary.
interface Signals {
  recommendation_key: string | null;
  recommendation_mean: number | null;
  analyst_count: number | null;
  target_mean: number | null;
  target_high: number | null;
  target_low: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  beta: number | null;
  short_ratio: number | null;
  fifty_two_week_change: number | null;
  earnings_surprise_pct: number | null;
  insider_net_shares: number | null;
  rating_changes: RatingChange[];
  recommendation_trend: RecTrendPoint[];
  earnings_trend: EarningsTrendPoint[];
}

const EMPTY_SIGNALS: Signals = {
  recommendation_key: null, recommendation_mean: null, analyst_count: null,
  target_mean: null, target_high: null, target_low: null,
  forward_pe: null, peg_ratio: null, beta: null, short_ratio: null,
  fifty_two_week_change: null, earnings_surprise_pct: null,
  insider_net_shares: null, rating_changes: [],
  recommendation_trend: [], earnings_trend: [],
};

function toISODate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

async function fetchSignals(ticker: string): Promise<Signals> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await yahooFinance.quoteSummary(ticker, {
      modules: [
        'financialData', 'defaultKeyStatistics', 'earningsHistory',
        'upgradeDowngradeHistory', 'netSharePurchaseActivity',
        'recommendationTrend', 'earningsTrend',
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const fd = s.financialData ?? {};
    const ks = s.defaultKeyStatistics ?? {};
    const eh: any[] = s.earningsHistory?.history ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const lastEarnings = eh.length ? eh[eh.length - 1] : null;
    const ns = s.netSharePurchaseActivity ?? {};

    const rating_changes: RatingChange[] = (s.upgradeDowngradeHistory?.history ?? [])
      .slice(0, 8)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((h: any) => ({
        date: toISODate(h.epochGradeDate),
        firm: h.firm ?? '',
        from_grade: h.fromGrade ?? '',
        to_grade: h.toGrade ?? '',
        action: h.action ?? '',
      }));

    const recommendation_trend: RecTrendPoint[] = (s.recommendationTrend?.trend ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => ({
        period: r.period ?? '',
        strongBuy: r.strongBuy ?? 0,
        buy: r.buy ?? 0,
        hold: r.hold ?? 0,
        sell: r.sell ?? 0,
        strongSell: r.strongSell ?? 0,
      }));

    const earnings_trend: EarningsTrendPoint[] = (s.earningsTrend?.trend ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((t: any) => ({
        period: t.period ?? '',
        growth: t.growth ?? null,
        eps_up_30d: t.epsRevisions?.upLast30days ?? null,
        eps_down_30d: t.epsRevisions?.downLast30days ?? null,
      }))
      // keep only horizons we use; drop empty rows
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((t: EarningsTrendPoint) =>
        t.growth != null || t.eps_up_30d != null || t.eps_down_30d != null);

    return {
      recommendation_key: fd.recommendationKey ?? null,
      recommendation_mean: fd.recommendationMean ?? null,
      analyst_count: fd.numberOfAnalystOpinions ?? null,
      target_mean: fd.targetMeanPrice ?? null,
      target_high: fd.targetHighPrice ?? null,
      target_low: fd.targetLowPrice ?? null,
      forward_pe: ks.forwardPE ?? null,
      peg_ratio: ks.pegRatio ?? null,
      beta: ks.beta ?? null,
      short_ratio: ks.shortRatio ?? null,
      fifty_two_week_change: ks['52WeekChange'] ?? null,
      earnings_surprise_pct: lastEarnings?.surprisePercent ?? null,
      insider_net_shares:
        ns.buyInfoShares != null && ns.sellInfoShares != null
          ? ns.buyInfoShares - ns.sellInfoShares
          : null,
      rating_changes,
      recommendation_trend,
      earnings_trend,
    };
  } catch {
    return EMPTY_SIGNALS;
  }
}

const upsertSummary = db.prepare(`
  INSERT INTO daily_summaries (
    ticker, date, open, high, low, close, previous_close, change, change_pct,
    volume, market_cap, currency, news,
    recommendation_key, recommendation_mean, analyst_count,
    target_mean, target_high, target_low, forward_pe, peg_ratio, beta,
    short_ratio, fifty_two_week_change, earnings_surprise_pct,
    insider_net_shares, rating_changes, recommendation_trend, earnings_trend, fetched_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(ticker, date) DO UPDATE SET
    open = excluded.open, high = excluded.high, low = excluded.low,
    close = excluded.close, previous_close = excluded.previous_close,
    change = excluded.change, change_pct = excluded.change_pct,
    volume = excluded.volume, market_cap = excluded.market_cap,
    currency = excluded.currency, news = excluded.news,
    recommendation_key = excluded.recommendation_key,
    recommendation_mean = excluded.recommendation_mean,
    analyst_count = excluded.analyst_count,
    target_mean = excluded.target_mean, target_high = excluded.target_high,
    target_low = excluded.target_low, forward_pe = excluded.forward_pe,
    peg_ratio = excluded.peg_ratio, beta = excluded.beta,
    short_ratio = excluded.short_ratio,
    fifty_two_week_change = excluded.fifty_two_week_change,
    earnings_surprise_pct = excluded.earnings_surprise_pct,
    insider_net_shares = excluded.insider_net_shares,
    rating_changes = excluded.rating_changes,
    recommendation_trend = excluded.recommendation_trend,
    earnings_trend = excluded.earnings_trend,
    fetched_at = datetime('now')
`);

async function processTicker(ticker: string, date: string, backfill = false): Promise<boolean> {
  if (ticker.startsWith('NSENG:')) return false;

  try {
    const quote = await yahooFinance.quote(ticker);

    // Freshness guard (live path only): if the quote's last trade isn't from the
    // target day, the market didn't trade then (weekend/holiday) or the run is
    // mistimed — skip rather than write a stale snapshot under today's date. Crypto
    // trades daily so it still passes on weekends; backfill uses historical bars.
    if (!backfill && quote.regularMarketTime && toISODate(quote.regularMarketTime) !== date) {
      return false;
    }

    // Default to the live quote's OHLC. For a past-date backfill, override the
    // price fields with that day's actual historical bar — currency, marketCap and
    // analyst signals stay current, which is acceptable for a recent backfill since
    // only the OHLC snapshot is genuinely date-specific.
    let open = quote.regularMarketOpen ?? null;
    let high = quote.regularMarketDayHigh ?? null;
    let low = quote.regularMarketDayLow ?? null;
    let close = quote.regularMarketPrice ?? null;
    let previousClose = quote.regularMarketPreviousClose ?? null;
    let change = quote.regularMarketChange ?? null;
    let changePct = quote.regularMarketChangePercent ?? null;
    let volume = quote.regularMarketVolume ?? null;

    if (backfill) {
      const target = new Date(`${date}T00:00:00Z`);
      const period1 = new Date(target.getTime() - 7 * 86400000); // look back for prev close
      const period2 = new Date(target.getTime() + 86400000);
      const bars = await yahooFinance.historical(ticker, { period1, period2 });
      const idx = bars.findIndex(b => b.date.toISOString().split('T')[0] === date);
      if (idx === -1) return false;
      const bar = bars[idx];
      const prev = idx > 0 ? bars[idx - 1] : null;
      open = bar.open ?? null;
      high = bar.high ?? null;
      low = bar.low ?? null;
      close = bar.close ?? null;
      previousClose = prev?.close ?? null;
      change = previousClose != null && close != null ? close - previousClose : null;
      changePct = previousClose && close != null ? ((close - previousClose) / previousClose) * 100 : null;
      volume = bar.volume ?? null;
    }

    if (close == null) return false;

    const meta = db.prepare('SELECT name FROM ticker_metadata WHERE ticker = ?')
      .get(ticker) as { name: string } | undefined;

    const [yahooNews, braveNews, signals] = await Promise.all([
      fetchYahooNews(ticker),
      fetchBraveNews(ticker, meta?.name || undefined),
      fetchSignals(ticker),
    ]);
    const allNews = deduplicateNews([...yahooNews, ...braveNews]);

    upsertSummary.run(
      ticker, date,
      open,
      high,
      low,
      close,
      previousClose,
      change,
      changePct,
      volume,
      quote.marketCap ?? null,
      quote.currency || 'USD',
      JSON.stringify(allNews),
      signals.recommendation_key,
      signals.recommendation_mean,
      signals.analyst_count,
      signals.target_mean,
      signals.target_high,
      signals.target_low,
      signals.forward_pe,
      signals.peg_ratio,
      signals.beta,
      signals.short_ratio,
      signals.fifty_two_week_change,
      signals.earnings_surprise_pct,
      signals.insider_net_shares,
      JSON.stringify(signals.rating_changes),
      JSON.stringify(signals.recommendation_trend),
      JSON.stringify(signals.earnings_trend),
    );
    return true;
  } catch {
    return false;
  }
}

export async function runDailySummaries(
  targetDate?: string
): Promise<{ date: string; success: number; total: number }> {
  const today = new Date().toISOString().split('T')[0];
  const date = targetDate ?? today;
  // A past target date means a backfill: pull each ticker's actual historical bar
  // for that day rather than the live quote.
  const backfill = date < today;
  const tickers = getTickersToSummarize();
  if (tickers.length === 0) return { date, success: 0, total: 0 };

  let success = 0;
  for (const ticker of tickers) {
    const ok = await processTicker(ticker, date, backfill);
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
