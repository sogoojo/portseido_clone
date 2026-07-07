import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { seedAccounts } from './seed';
import { seedTargets } from './seed-targets';
import { seedWatchlist, seedNgxWatchlist } from './seed-watchlist';

const DB_PATH = path.join(process.cwd(), 'data', 'portseido-lite.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Run schema migration
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');

// Synchronous sleep (no deps) so the init retry loop below can back off between
// attempts at module-eval time, where nothing async is available.
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isLockError(err: unknown): boolean {
  return /database is locked|SQLITE_BUSY/i.test((err as Error)?.message ?? '');
}

/**
 * Open the connection and bring the schema up to date. Every step here is
 * idempotent (CREATE TABLE IF NOT EXISTS, duplicate-column-tolerant ALTERs,
 * OR IGNORE migrations/seeds), so the caller can retry the whole thing on a
 * lock without side effects. Retrying is what actually fixes the build race:
 * `next build` runs several page-data workers that each init this fresh DB at
 * once, and `PRAGMA journal_mode=WAL` / DDL take an exclusive lock that
 * busy_timeout doesn't reliably cover — but on a retry the pragma is a no-op
 * once another worker has already switched the file to WAL.
 */
function openAndInit(): Database.Database {
  const conn = new Database(DB_PATH);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 20000');

  conn.exec(schema);

  // Migrations
  // Column additions are idempotent via the duplicate-column check below.
  // Data migrations (like the track_cash defaults) must run ONCE — re-running
  // them on every boot would undo later user changes — so they are tracked
  // in the _migrations table.
  conn.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const migrations = [
  `ALTER TABLE price_cache ADD COLUMN previous_close REAL`,
  `ALTER TABLE price_cache ADD COLUMN change REAL`,
  `ALTER TABLE price_cache ADD COLUMN change_pct REAL`,
  `ALTER TABLE accounts ADD COLUMN track_cash INTEGER NOT NULL DEFAULT 1`,
  // Free structured analyst/fundamental signals on daily_summaries
  `ALTER TABLE daily_summaries ADD COLUMN recommendation_key TEXT`,
  `ALTER TABLE daily_summaries ADD COLUMN recommendation_mean REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN analyst_count INTEGER`,
  `ALTER TABLE daily_summaries ADD COLUMN target_mean REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN target_high REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN target_low REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN forward_pe REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN peg_ratio REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN beta REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN short_ratio REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN fifty_two_week_change REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN earnings_surprise_pct REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN insider_net_shares REAL`,
  `ALTER TABLE daily_summaries ADD COLUMN rating_changes TEXT`,
  `ALTER TABLE daily_summaries ADD COLUMN recommendation_trend TEXT`,
  `ALTER TABLE daily_summaries ADD COLUMN earnings_trend TEXT`,
  // 52-week high + 200-day average cached for watchlist signals / dynamic targets
  `ALTER TABLE price_cache ADD COLUMN fifty_two_week_high REAL`,
  `ALTER TABLE price_cache ADD COLUMN fifty_two_week_low REAL`,
  `ALTER TABLE price_cache ADD COLUMN fifty_day_avg REAL`,
  `ALTER TABLE price_cache ADD COLUMN two_hundred_day_avg REAL`,
  // Watchlist buy-signal fields
  `ALTER TABLE watchlist ADD COLUMN target_entry REAL`,
  `ALTER TABLE watchlist ADD COLUMN tier INTEGER`,
  `ALTER TABLE watchlist ADD COLUMN notes TEXT`,
  // Action-item reminders (ISO 8601 UTC): remind_at = when to nudge,
  // notified_at = when a Telegram push went out (null = still pending)
  `ALTER TABLE portfolio_notes ADD COLUMN remind_at TEXT`,
  `ALTER TABLE portfolio_notes ADD COLUMN notified_at TEXT`,
  // Price-triggered alerts: fire when ticker crosses trigger_price ('above'/'below')
  `ALTER TABLE portfolio_notes ADD COLUMN trigger_price REAL`,
  `ALTER TABLE portfolio_notes ADD COLUMN trigger_direction TEXT`,
  // Earliest date the price source has data for (IPO/listing date) — lets the
  // historical-price cache check stop re-fetching ranges that predate the series
  `ALTER TABLE ticker_metadata ADD COLUMN history_start TEXT`,
];
  for (const sql of migrations) {
    try {
      conn.exec(sql);
    } catch (err) {
      // Only an already-applied column addition is expected — anything else is
      // a real migration failure and must not be silently swallowed
      if (!/duplicate column name/i.test((err as Error).message)) throw err;
    }
  }

  // One-time data migrations
  const dataMigrations: { name: string; sql: string }[] = [
  {
    name: 'track-cash-defaults',
    sql: `UPDATE accounts SET track_cash = 0 WHERE id IN ('trading212', 'degiro', 'morgan-stanley', 'crypto', 'ngx')`,
  },
  {
    // CRWD's 4:1 split (2026-07-02) was restated by hand before auto-detection
    // existed — record it so the split checker doesn't apply it a second time
    name: 'crwd-split-2026-07-02-already-applied',
    sql: `INSERT OR IGNORE INTO applied_splits (ticker, split_date, numerator, denominator) VALUES ('CRWD', '2026-07-02', 4, 1)`,
  },
  {
    // Trader Republic funds arrive via transfer only when buying — deposits
    // don't represent held cash, so cash tracking just shows phantom negatives
    name: 'trader-republic-no-cash-tracking',
    sql: `UPDATE accounts SET track_cash = 0 WHERE id = 'trader-republic'`,
  },
];
  const isApplied = conn.prepare('SELECT 1 FROM _migrations WHERE name = ?');
  // OR IGNORE: parallel processes (e.g. next build page-data workers) can race
  // on a fresh DB — each migration's SQL is idempotent, so a double run is
  // harmless but a UNIQUE violation here would crash module init
  const markApplied = conn.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)');
  for (const m of dataMigrations) {
    if (isApplied.get(m.name)) continue;
    conn.transaction(() => {
      conn.exec(m.sql);
      markApplied.run(m.name);
    })();
  }

  // Seed accounts on first connection
  seedAccounts(conn);
  seedTargets(conn);
  seedWatchlist(conn);
  seedNgxWatchlist(conn);

  return conn;
}

// Open with a bounded retry so a lost init race (see openAndInit) recovers
// instead of crashing the build. All init steps are idempotent, so re-running
// after closing the half-open connection is safe.
function connect(): Database.Database {
  const MAX_ATTEMPTS = 15;
  for (let attempt = 1; ; attempt++) {
    let conn: Database.Database | null = null;
    try {
      conn = openAndInit();
      return conn;
    } catch (err) {
      try { conn?.close(); } catch { /* ignore */ }
      if (isLockError(err) && attempt < MAX_ATTEMPTS) {
        sleepSync(150 + attempt * 100);
        continue;
      }
      throw err;
    }
  }
}

const db = connect();

export default db;
