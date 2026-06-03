import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { seedAccounts } from './seed';
import { seedTargets } from './seed-targets';
import { seedWatchlist } from './seed-watchlist';

const DB_PATH = path.join(process.cwd(), 'data', 'portseido-lite.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema migration
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// Migrations
const migrations = [
  `ALTER TABLE price_cache ADD COLUMN previous_close REAL`,
  `ALTER TABLE price_cache ADD COLUMN change REAL`,
  `ALTER TABLE price_cache ADD COLUMN change_pct REAL`,
  `ALTER TABLE accounts ADD COLUMN track_cash INTEGER NOT NULL DEFAULT 1`,
  `UPDATE accounts SET track_cash = 0 WHERE id IN ('trading212', 'degiro', 'morgan-stanley', 'crypto', 'ngx')`,
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
];
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// Seed accounts on first connection
seedAccounts(db);
seedTargets(db);
seedWatchlist(db);

export default db;
