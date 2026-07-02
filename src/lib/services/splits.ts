import YahooFinance from 'yahoo-finance2';
import type { Database } from 'better-sqlite3';
import db from '@/lib/db';
import { isTelegramConfigured, sendTelegramMessage } from '@/lib/services/telegram';
import type { ThesisTrigger } from '@/lib/types';

const yahooFinance = new YahooFinance();

// How far back to look for split events on each check. The daily cron plus the
// throttled on-load check both run well inside this window — it only needs to
// cover the app sitting completely idle for a stretch.
const LOOKBACK_DAYS = 21;

// Minimum gap between checks triggered from page loads. The cron still runs
// daily regardless; this just catches a split intraday instead of showing a
// fake crash until the evening cron.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;

export interface AppliedSplit {
  ticker: string;
  split_date: string;
  numerator: number;
  denominator: number;
  transactions_adjusted: number;
}

export interface SplitCheckResult {
  checked: number;
  applied: AppliedSplit[];
  errors: string[];
}

/**
 * Held tickers + watchlist names that can split and have a Yahoo split feed:
 * NGX prices come from TradingView (no split events) and crypto/FX don't split.
 */
function candidateTickers(conn: Database = db): string[] {
  const rows = conn.prepare(`
    SELECT t.ticker FROM (
      SELECT ticker FROM transactions WHERE ticker IS NOT NULL GROUP BY ticker
        HAVING SUM(CASE WHEN type = 'buy' THEN quantity WHEN type = 'sell' THEN -quantity ELSE 0 END) > 1e-9
      UNION
      SELECT ticker FROM watchlist
    ) t
    LEFT JOIN ticker_metadata m ON m.ticker = t.ticker
    WHERE t.ticker NOT LIKE 'NSENG:%'
      AND (m.market IS NULL OR m.market != 'ngx')
      AND (m.asset_type IS NULL OR m.asset_type IN ('equity', 'etf'))
  `).all() as { ticker: string }[];
  return rows.map(r => r.ticker);
}

/**
 * Restate everything price/quantity-denominated to post-split terms so stored
 * data lines up with Yahoo's back-adjusted feed. Rows dated on/after the
 * effective date are assumed already post-split (brokers record them that way).
 * Idempotent per (ticker, split_date) via the applied_splits primary key.
 * Returns null if this split was already applied.
 */
export function applySplitToDb(
  conn: Database,
  ticker: string,
  splitDate: string,
  numerator: number,
  denominator: number
): AppliedSplit | null {
  const ratio = numerator / denominator;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) {
    throw new Error(`Invalid split ratio ${numerator}:${denominator} for ${ticker}`);
  }

  const already = conn.prepare(
    'SELECT 1 FROM applied_splits WHERE ticker = ? AND split_date = ?'
  ).get(ticker, splitDate);
  if (already) return null;

  let txCount = 0;
  conn.transaction(() => {
    conn.prepare(
      'INSERT INTO applied_splits (ticker, split_date, numerator, denominator) VALUES (?, ?, ?, ?)'
    ).run(ticker, splitDate, numerator, denominator);

    txCount = conn.prepare(
      `UPDATE transactions SET quantity = quantity * ?, price_per_unit = price_per_unit / ?
       WHERE ticker = ? AND date < ?`
    ).run(ratio, ratio, ticker, splitDate).changes;

    conn.prepare(
      `UPDATE watchlist SET target_entry = target_entry / ?
       WHERE ticker = ? AND target_entry IS NOT NULL AND date(added_at) < ?`
    ).run(ratio, ticker, splitDate);

    conn.prepare(
      `UPDATE daily_summaries SET
         open = open / @r, high = high / @r, low = low / @r, close = close / @r,
         previous_close = previous_close / @r, change = change / @r,
         volume = volume * @r,
         target_mean = target_mean / @r, target_high = target_high / @r, target_low = target_low / @r
       WHERE ticker = @ticker AND date < @splitDate`
    ).run({ r: ratio, ticker, splitDate });

    // price_below thesis triggers carry an absolute price threshold
    const thesis = conn.prepare('SELECT triggers FROM theses WHERE ticker = ?').get(ticker) as { triggers: string } | undefined;
    if (thesis) {
      const triggers = JSON.parse(thesis.triggers) as ThesisTrigger[];
      let changed = false;
      for (const t of triggers) {
        if (t.metric === 'price_below' && t.param != null) {
          t.param = t.param / ratio;
          changed = true;
        }
      }
      if (changed) {
        conn.prepare('UPDATE theses SET triggers = ? WHERE ticker = ?').run(JSON.stringify(triggers), ticker);
      }
    }

    // Cached candles are pre-split; drop them so Yahoo's back-adjusted history refetches
    conn.prepare('DELETE FROM price_cache WHERE ticker = ?').run(ticker);
  })();

  return { ticker, split_date: splitDate, numerator, denominator, transactions_adjusted: txCount };
}

async function fetchRecentSplits(ticker: string): Promise<{ date: string; numerator: number; denominator: number }[]> {
  const period1 = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const chart = await yahooFinance.chart(ticker, { period1, interval: '1d', events: 'splits' });
  const splits = chart?.events?.splits ?? [];
  const today = new Date().toISOString().split('T')[0];
  return splits
    .map(s => ({
      date: new Date(s.date).toISOString().split('T')[0],
      numerator: s.numerator,
      denominator: s.denominator,
    }))
    .filter(s => s.date <= today && s.numerator > 0 && s.denominator > 0);
}

/**
 * Scan held + watchlist tickers for recent Yahoo split events and restate
 * stored data for any not yet applied. Sends a Telegram note per applied split.
 */
export async function checkAndApplySplits(): Promise<SplitCheckResult> {
  const tickers = candidateTickers();
  const applied: AppliedSplit[] = [];
  const errors: string[] = [];

  for (const ticker of tickers) {
    let events: { date: string; numerator: number; denominator: number }[];
    try {
      events = await fetchRecentSplits(ticker);
    } catch (err) {
      // Per-ticker failure must not kill the sweep (delisted names, Yahoo hiccups)
      errors.push(`${ticker}: ${(err as Error).message}`);
      continue;
    }

    for (const ev of events) {
      try {
        const result = applySplitToDb(db, ticker, ev.date, ev.numerator, ev.denominator);
        if (!result) continue;
        applied.push(result);
        console.log(`[Splits] Applied ${ticker} ${ev.numerator}:${ev.denominator} split (${ev.date}), ${result.transactions_adjusted} transactions restated`);
        if (isTelegramConfigured()) {
          await sendTelegramMessage(
            `📊 Stock split auto-applied: ${ticker} ${ev.numerator}:${ev.denominator} effective ${ev.date}. ` +
            `${result.transactions_adjusted} transactions restated to post-split terms (value and cost basis unchanged); price cache refreshed.`
          ).catch(err => console.error('[Splits] Telegram notify failed:', err));
        }
      } catch (err) {
        errors.push(`${ticker} ${ev.date}: ${(err as Error).message}`);
      }
    }
  }

  return { checked: tickers.length, applied, errors };
}

/**
 * Throttled fire-and-forget split check for hot paths (portfolio load). At most
 * one sweep per CHECK_THROTTLE_MS; the timestamp is claimed up front so
 * concurrent requests don't stampede Yahoo.
 */
export function maybeCheckSplits(): void {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'last_split_check'").get() as { value: string } | undefined;
  if (row && Date.now() - new Date(row.value).getTime() < CHECK_THROTTLE_MS) return;

  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES ('last_split_check', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(new Date().toISOString());

  checkAndApplySplits()
    .then(r => {
      if (r.applied.length > 0 || r.errors.length > 0) {
        console.log(`[Splits] Background check: ${r.applied.length} applied, ${r.errors.length} errors`, r.errors);
      }
    })
    .catch(err => console.error('[Splits] Background check failed:', err));
}
