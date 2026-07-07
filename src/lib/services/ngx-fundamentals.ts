import db from '@/lib/db';

// TradingView's screener/scanner endpoint — the same data their web screener and
// mobile app show. Unofficial but keyless; same access category as the candle
// WebSocket this app already uses for NGX prices. The "nigeria" market returns
// native NGN figures (market cap in NGN, EPS in naira).
const SCANNER_URL = 'https://scanner.tradingview.com/nigeria/scan';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Column order MUST match the parsing below — the scanner returns bare value
// arrays aligned to the requested columns.
const COLUMNS = [
  'price_earnings_ttm',
  'price_book_fq',
  'earnings_per_share_basic_ttm',
  'market_cap_basic',
  'dividend_yield_recent',
  'net_margin',
] as const;

// Fundamentals move on quarterly results, not intraday — a slow refresh is fine.
// The nightly cron also warms them, so page visits are cache reads.
const FUNDAMENTALS_STALENESS_MS = 6 * 60 * 60 * 1000;
const REFRESH_KEY = 'ngx_fundamentals_last_refresh';

export interface NgxFundamentals {
  pe: number | null;
  pb: number | null;
  eps: number | null;
  market_cap: number | null;
  dividend_yield: number | null;
  net_margin: number | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function lastRefreshMs(): number {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(REFRESH_KEY) as { value: string } | undefined;
  const t = row ? Date.parse(row.value) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

const upsert = db.prepare(
  `INSERT INTO ngx_fundamentals (ticker, pe, pb, eps, market_cap, dividend_yield, net_margin, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
   ON CONFLICT(ticker) DO UPDATE SET
     pe = excluded.pe, pb = excluded.pb, eps = excluded.eps,
     market_cap = excluded.market_cap, dividend_yield = excluded.dividend_yield,
     net_margin = excluded.net_margin, fetched_at = datetime('now')`
);

/**
 * Refresh valuation fundamentals for the given NGX tickers when the cache is
 * stale. One scanner POST covers all tickers. Best-effort: on any failure the
 * refresh timestamp is left untouched so the next call retries rather than
 * serving nothing for the whole window.
 */
export async function refreshNgxFundamentals(
  tickers: string[],
  nowMs: number = Date.now(),
  force = false
): Promise<number> {
  if (tickers.length === 0) return 0;
  if (!force && nowMs - lastRefreshMs() < FUNDAMENTALS_STALENESS_MS) return 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(SCANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: COLUMNS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[ngx-fundamentals] scanner returned ${res.status}`);
      return 0;
    }
    const json = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    const rows = json.data ?? [];
    if (rows.length === 0) return 0;

    const writeAll = db.transaction(() => {
      for (const r of rows) {
        const [pe, pb, eps, marketCap, divYield, netMargin] = r.d;
        upsert.run(r.s, num(pe), num(pb), num(eps), num(marketCap), num(divYield), num(netMargin));
      }
      db.prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(REFRESH_KEY, new Date(nowMs).toISOString());
    });
    writeAll();
    return rows.length;
  } catch (err) {
    console.error('[ngx-fundamentals] fetch failed:', err);
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

interface FundRow {
  ticker: string;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  market_cap: number | null;
  dividend_yield: number | null;
  net_margin: number | null;
}

/** Cached fundamentals per ticker (empty entries when nothing is cached yet). */
export function getNgxFundamentals(tickers: string[]): Map<string, NgxFundamentals> {
  const out = new Map<string, NgxFundamentals>();
  if (tickers.length === 0) return out;
  const placeholders = tickers.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT ticker, pe, pb, eps, market_cap, dividend_yield, net_margin
     FROM ngx_fundamentals WHERE ticker IN (${placeholders})`
  ).all(...tickers) as FundRow[];
  for (const r of rows) {
    out.set(r.ticker, {
      pe: r.pe, pb: r.pb, eps: r.eps,
      market_cap: r.market_cap, dividend_yield: r.dividend_yield, net_margin: r.net_margin,
    });
  }
  return out;
}
