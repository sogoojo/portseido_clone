import type BetterSqlite3 from 'better-sqlite3';

// Migrated from the user's "Watchlist" spreadsheet tab. target_entry is their
// conviction buy price (the anchor); tier 1/2/3; notes carry the thesis.
// SELL/AVOID rows (SNOW, TWLO, IREN, MU) are intentionally excluded.
const WATCHLIST: { ticker: string; tier: number; target_entry: number; notes: string }[] = [
  { ticker: 'GOOGL', tier: 1, target_entry: 300, notes: 'Cheapest mega-cap, highest conviction' },
  { ticker: 'MSFT', tier: 1, target_entry: 440, notes: 'Severely underweight, quality compounder' },
  { ticker: 'AMZN', tier: 1, target_entry: 195, notes: 'AWS + ads, quality' },
  { ticker: 'AAPL', tier: 1, target_entry: 235, notes: 'Underweight, cash machine' },
  { ticker: 'META', tier: 1, target_entry: 620, notes: 'AI working, cheap valuation' },
  { ticker: 'NVDA', tier: 1, target_entry: 170, notes: 'AI leader' },
  { ticker: 'AVGO', tier: 1, target_entry: 300, notes: 'Best AI semi value - underweight' },
  { ticker: 'MA', tier: 1, target_entry: 500, notes: 'Duopoly' },
  { ticker: 'CRWD', tier: 2, target_entry: 380, notes: 'Cybersecurity leader' },
  { ticker: 'MELI', tier: 2, target_entry: 1900, notes: 'LatAm winner' },
  { ticker: 'NET', tier: 2, target_entry: 175, notes: 'Above target allocation' },
  { ticker: 'VRT', tier: 2, target_entry: 220, notes: 'Data center power play' },
  { ticker: 'AMD', tier: 2, target_entry: 190, notes: 'AI challenger, underweight' },
  { ticker: 'MRVL', tier: 2, target_entry: 280, notes: 'AI/data-center semi, custom silicon' },
  { ticker: 'NU', tier: 2, target_entry: 13, notes: 'LatAm fintech, 2x potential' },
  { ticker: 'NVO', tier: 2, target_entry: 43, notes: 'GLP-1 leader' },
  { ticker: 'AXON', tier: 2, target_entry: 451, notes: 'Defense tech, quality compounder' },
  { ticker: 'UBER', tier: 2, target_entry: 71, notes: 'Caution - dead money risk' },
  { ticker: 'SHOP', tier: 2, target_entry: 118, notes: 'SMB ecommerce' },
  { ticker: 'NOW', tier: 2, target_entry: 99, notes: 'Falling knife - wait for stabilization' },
  { ticker: 'PLTR', tier: 3, target_entry: 125, notes: 'AI/Gov, expensive' },
  { ticker: 'COIN', tier: 3, target_entry: 165, notes: 'Crypto proxy' },
  { ticker: 'RKLB', tier: 3, target_entry: 65, notes: 'Space moonshot' },
  { ticker: 'CRWV', tier: 3, target_entry: 82, notes: 'AI infra bet - 1.5% max' },
  { ticker: 'NBIS', tier: 3, target_entry: 85, notes: 'AI infra bet - 1.5% max' },
  { ticker: 'TSLA', tier: 3, target_entry: 390, notes: 'Overweight for fundamentals' },
  { ticker: 'SOFI', tier: 3, target_entry: 24, notes: 'Overweight, weak thesis' },
  { ticker: 'SE', tier: 3, target_entry: 100, notes: 'SEA turnaround' },
  { ticker: 'DDOG', tier: 3, target_entry: 122, notes: 'Small position, let ride' },
];

// Nigerian (NGX) watchlist — tracked in a separate section of the watchlist
// page. No analyst data exists for these; signals derive from TradingView
// candle history (50/200-day MAs, 52-week range).
const NGX_WATCHLIST: { ticker: string; name: string }[] = [
  { ticker: 'NSENG:DANGCEM', name: 'Dangote Cement' },
  { ticker: 'NSENG:ZENITHBANK', name: 'Zenith Bank' },
  { ticker: 'NSENG:ACCESSCORP', name: 'Access Holdings' },
  { ticker: 'NSENG:FCMB', name: 'FCMB Group' },
  { ticker: 'NSENG:MTNN', name: 'MTN Nigeria' },
  { ticker: 'NSENG:NESTLE', name: 'Nestle Nigeria' },
  { ticker: 'NSENG:BETAGLAS', name: 'Beta Glass' },
  { ticker: 'NSENG:WAPCO', name: 'Lafarge Africa' },
  { ticker: 'NSENG:PRESCO', name: 'Presco' },
  { ticker: 'NSENG:OKOMUOIL', name: 'Okomu Oil Palm' },
  { ticker: 'NSENG:SEPLAT', name: 'Seplat Energy' },
  { ticker: 'NSENG:UBA', name: 'United Bank for Africa' },
  { ticker: 'NSENG:BUAFOODS', name: 'BUA Foods' },
  { ticker: 'NSENG:AIICO', name: 'AIICO Insurance' },
  { ticker: 'NSENG:NEM', name: 'NEM Insurance' },
  { ticker: 'NSENG:ARADEL', name: 'Aradel Holdings' },
  { ticker: 'NSENG:MECURE', name: 'MeCure Industries' },
  { ticker: 'NSENG:BUACEMENT', name: 'BUA Cement' },
];

// Seed once: only if no watchlist row has a target yet (stray tickers from the
// summaries feature don't count, and user edits are never overwritten).
export function seedWatchlist(db: BetterSqlite3.Database): void {
  const withTarget = (db.prepare(
    'SELECT COUNT(*) AS c FROM watchlist WHERE target_entry IS NOT NULL'
  ).get() as { c: number }).c;
  if (withTarget > 0) return;

  const insert = db.prepare(
    `INSERT INTO watchlist (ticker, target_entry, tier, notes) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       target_entry = excluded.target_entry, tier = excluded.tier, notes = excluded.notes`
  );
  const tx = db.transaction(() => {
    for (const w of WATCHLIST) insert.run(w.ticker, w.target_entry, w.tier, w.notes);
  });
  tx();
}

// One-time seed of the NGX watchlist, tracked in _migrations so later
// deletions by the user are never re-added on boot.
export function seedNgxWatchlist(db: BetterSqlite3.Database): void {
  const applied = db.prepare(`SELECT 1 FROM _migrations WHERE name = 'seed-ngx-watchlist'`).get();
  if (applied) return;

  const insert = db.prepare(
    `INSERT INTO watchlist (ticker, name) VALUES (?, ?)
     ON CONFLICT(ticker) DO UPDATE SET name = COALESCE(watchlist.name, excluded.name)`
  );
  const tx = db.transaction(() => {
    for (const w of NGX_WATCHLIST) insert.run(w.ticker, w.name);
    // OR IGNORE: two processes can race past the applied-check on a fresh DB
    db.prepare(`INSERT OR IGNORE INTO _migrations (name) VALUES ('seed-ngx-watchlist')`).run();
  });
  tx();
}
