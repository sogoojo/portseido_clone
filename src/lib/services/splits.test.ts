import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySplitToDb } from './splits';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL, date DATE NOT NULL, type TEXT NOT NULL,
      ticker TEXT, quantity REAL, price_per_unit REAL, amount REAL,
      currency TEXT NOT NULL, commission REAL DEFAULT 0, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE watchlist (
      ticker TEXT PRIMARY KEY, name TEXT, target_entry REAL, tier INTEGER,
      notes TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE daily_summaries (
      ticker TEXT NOT NULL, date DATE NOT NULL,
      open REAL, high REAL, low REAL, close REAL NOT NULL,
      previous_close REAL, change REAL, change_pct REAL, volume REAL,
      market_cap REAL, currency TEXT NOT NULL,
      target_mean REAL, target_high REAL, target_low REAL,
      PRIMARY KEY (ticker, date)
    );
    CREATE TABLE theses (
      ticker TEXT PRIMARY KEY, role TEXT, thesis TEXT, target_weight REAL,
      triggers TEXT NOT NULL DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE price_cache (
      ticker TEXT NOT NULL, date DATE NOT NULL, close REAL NOT NULL,
      currency TEXT NOT NULL, PRIMARY KEY (ticker, date)
    );
    CREATE TABLE applied_splits (
      ticker TEXT NOT NULL, split_date DATE NOT NULL,
      numerator REAL NOT NULL, denominator REAL NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticker, split_date)
    );
  `);
  return db;
}

describe('applySplitToDb', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = memDb();
    db.prepare(
      `INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency)
       VALUES ('trading212', '2026-01-10', 'buy', 'NVDA', 10, 800, 8000, 'USD'),
              ('trading212', '2026-06-01', 'sell', 'NVDA', 2, 1000, 2000, 'USD'),
              ('trading212', '2026-07-03', 'buy', 'NVDA', 5, 105, 525, 'USD'),
              ('trading212', '2026-01-10', 'buy', 'AAPL', 3, 200, 600, 'USD')`
    ).run();
    db.prepare(
      `INSERT INTO watchlist (ticker, target_entry, added_at) VALUES ('NVDA', 700, '2026-05-01 10:00:00')`
    ).run();
    db.prepare(
      `INSERT INTO daily_summaries (ticker, date, open, high, low, close, previous_close, change, volume, market_cap, currency, target_mean)
       VALUES ('NVDA', '2026-07-01', 900, 920, 890, 910, 905, 5, 1000, 2.2e12, 'USD', 1000),
              ('NVDA', '2026-07-03', 92, 93, 91, 92.5, 91, 1.5, 10000, 2.2e12, 'USD', 100)`
    ).run();
    db.prepare(
      `INSERT INTO theses (ticker, triggers) VALUES ('NVDA', ?)`
    ).run(JSON.stringify([
      { id: '1', text: 'price under 600', kind: 'auto', metric: 'price_below', param: 600 },
      { id: '2', text: 'trend break', kind: 'auto', metric: 'below_200d' },
    ]));
    db.prepare(
      `INSERT INTO price_cache (ticker, date, close, currency) VALUES ('NVDA', '2026-07-01', 910, 'USD'), ('AAPL', '2026-07-01', 210, 'USD')`
    ).run();
  });

  it('restates pre-split transactions and leaves post-split ones alone', () => {
    const result = applySplitToDb(db, 'NVDA', '2026-07-03', 10, 1);
    expect(result).not.toBeNull();
    expect(result!.transactions_adjusted).toBe(2);

    const rows = db.prepare(
      "SELECT date, quantity, price_per_unit, amount FROM transactions WHERE ticker = 'NVDA' ORDER BY date"
    ).all() as { date: string; quantity: number; price_per_unit: number; amount: number }[];
    expect(rows[0]).toMatchObject({ quantity: 100, price_per_unit: 80, amount: 8000 });
    expect(rows[1]).toMatchObject({ quantity: 20, price_per_unit: 100, amount: 2000 });
    // dated on the effective date — already post-split, untouched
    expect(rows[2]).toMatchObject({ quantity: 5, price_per_unit: 105 });
  });

  it('does not touch other tickers', () => {
    applySplitToDb(db, 'NVDA', '2026-07-03', 10, 1);
    const aapl = db.prepare("SELECT quantity, price_per_unit FROM transactions WHERE ticker = 'AAPL'").get() as { quantity: number; price_per_unit: number };
    expect(aapl).toMatchObject({ quantity: 3, price_per_unit: 200 });
    const cache = db.prepare("SELECT COUNT(*) n FROM price_cache WHERE ticker = 'AAPL'").get() as { n: number };
    expect(cache.n).toBe(1);
  });

  it('adjusts watchlist target, pre-split summaries, price_below triggers; clears price cache', () => {
    applySplitToDb(db, 'NVDA', '2026-07-03', 10, 1);

    const wl = db.prepare("SELECT target_entry FROM watchlist WHERE ticker = 'NVDA'").get() as { target_entry: number };
    expect(wl.target_entry).toBe(70);

    const pre = db.prepare("SELECT close, volume, target_mean FROM daily_summaries WHERE ticker = 'NVDA' AND date = '2026-07-01'").get() as { close: number; volume: number; target_mean: number };
    expect(pre).toMatchObject({ close: 91, volume: 10000, target_mean: 100 });
    const post = db.prepare("SELECT close FROM daily_summaries WHERE ticker = 'NVDA' AND date = '2026-07-03'").get() as { close: number };
    expect(post.close).toBe(92.5);

    const triggers = JSON.parse((db.prepare("SELECT triggers FROM theses WHERE ticker = 'NVDA'").get() as { triggers: string }).triggers);
    expect(triggers[0].param).toBe(60);
    expect(triggers[1].param).toBeUndefined();

    const cache = db.prepare("SELECT COUNT(*) n FROM price_cache WHERE ticker = 'NVDA'").get() as { n: number };
    expect(cache.n).toBe(0);
  });

  it('is idempotent per (ticker, split_date)', () => {
    expect(applySplitToDb(db, 'NVDA', '2026-07-03', 10, 1)).not.toBeNull();
    expect(applySplitToDb(db, 'NVDA', '2026-07-03', 10, 1)).toBeNull();
    const row = db.prepare("SELECT quantity FROM transactions WHERE ticker = 'NVDA' AND date = '2026-01-10'").get() as { quantity: number };
    expect(row.quantity).toBe(100); // not 1000
  });

  it('handles reverse splits', () => {
    applySplitToDb(db, 'NVDA', '2026-07-03', 1, 5);
    const row = db.prepare("SELECT quantity, price_per_unit FROM transactions WHERE ticker = 'NVDA' AND date = '2026-01-10'").get() as { quantity: number; price_per_unit: number };
    expect(row.quantity).toBe(2);
    expect(row.price_per_unit).toBe(4000);
  });

  it('rejects nonsense ratios', () => {
    expect(() => applySplitToDb(db, 'NVDA', '2026-07-03', 1, 1)).toThrow();
    expect(() => applySplitToDb(db, 'NVDA', '2026-07-03', 0, 1)).toThrow();
  });
});
