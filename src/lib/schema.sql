CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  broker TEXT NOT NULL,
  currency TEXT NOT NULL,
  track_cash INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date DATE NOT NULL,
  type TEXT NOT NULL,
  ticker TEXT,
  quantity REAL,
  price_per_unit REAL,
  amount REAL,
  currency TEXT NOT NULL,
  commission REAL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_cache (
  ticker TEXT NOT NULL,
  date DATE NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL NOT NULL,
  previous_close REAL,
  change REAL,
  change_pct REAL,
  currency TEXT NOT NULL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS fx_cache (
  pair TEXT NOT NULL,
  date DATE NOT NULL,
  rate REAL NOT NULL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pair, date)
);

CREATE TABLE IF NOT EXISTS ticker_metadata (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT,
  industry TEXT,
  asset_type TEXT,
  market TEXT,
  currency TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_ticker ON transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_price_cache_ticker ON price_cache(ticker);

CREATE TABLE IF NOT EXISTS daily_summaries (
  ticker TEXT NOT NULL,
  date DATE NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL NOT NULL,
  previous_close REAL,
  change REAL,
  change_pct REAL,
  volume REAL,
  market_cap REAL,
  currency TEXT NOT NULL,
  news TEXT,
  -- Free structured analyst/fundamental signals (yahoo-finance2 quoteSummary)
  recommendation_key TEXT,        -- strong_buy | buy | hold | sell | strong_sell
  recommendation_mean REAL,       -- 1.0 (buy) .. 5.0 (sell)
  analyst_count INTEGER,          -- number of analyst opinions
  target_mean REAL,               -- mean analyst price target
  target_high REAL,
  target_low REAL,
  forward_pe REAL,
  peg_ratio REAL,
  beta REAL,
  short_ratio REAL,
  fifty_two_week_change REAL,     -- trailing 52w price change (fraction)
  earnings_surprise_pct REAL,     -- most recent quarter EPS surprise (fraction)
  insider_net_shares REAL,        -- insider buy shares - sell shares (period)
  rating_changes TEXT,            -- JSON: recent analyst upgrade/downgrade history
  recommendation_trend TEXT,      -- JSON: buy/hold/sell mix over recent months (0m,-1m,-2m,-3m)
  earnings_trend TEXT,            -- JSON: forward EPS growth + revision momentum per horizon
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);

CREATE TABLE IF NOT EXISTS watchlist (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
