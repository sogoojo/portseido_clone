import type BetterSqlite3 from 'better-sqlite3';

// Seeded from the user's "Targets" spreadsheet tab (per-stock target weights).
// tier: 1 = Stability, 2 = Growth, 3 = Speculative. target_pct in percent.
const TARGETS: { ticker: string; tier: number; target_pct: number }[] = [
  // Tier 1 — Stability
  { ticker: 'GOOGL', tier: 1, target_pct: 9 },
  { ticker: 'MSFT', tier: 1, target_pct: 5 },
  { ticker: 'AMZN', tier: 1, target_pct: 6 },
  { ticker: 'AAPL', tier: 1, target_pct: 3 },
  { ticker: 'META', tier: 1, target_pct: 5 },
  { ticker: 'NVDA', tier: 1, target_pct: 5 },
  { ticker: 'AVGO', tier: 1, target_pct: 5 },
  { ticker: 'V', tier: 1, target_pct: 3 },
  { ticker: 'MA', tier: 1, target_pct: 3 },
  // Tier 2 — Growth
  { ticker: 'CRWD', tier: 2, target_pct: 4 },
  { ticker: 'MELI', tier: 2, target_pct: 4 },
  { ticker: 'NET', tier: 2, target_pct: 3 },
  { ticker: 'VRT', tier: 2, target_pct: 2 },
  { ticker: 'AMD', tier: 2, target_pct: 3 },
  { ticker: 'NU', tier: 2, target_pct: 3 },
  { ticker: 'NVO', tier: 2, target_pct: 2 },
  { ticker: 'AXON', tier: 2, target_pct: 2 },
  { ticker: 'UBER', tier: 2, target_pct: 2 },
  { ticker: 'SHOP', tier: 2, target_pct: 2 },
  { ticker: 'NOW', tier: 2, target_pct: 2 },
  // Tier 3 — Speculative
  { ticker: 'PLTR', tier: 3, target_pct: 2 },
  { ticker: 'COIN', tier: 3, target_pct: 2 },
  { ticker: 'RKLB', tier: 3, target_pct: 2 },
  { ticker: 'CRWV', tier: 3, target_pct: 1.5 },
  { ticker: 'NBIS', tier: 3, target_pct: 1.5 },
  { ticker: 'TSLA', tier: 3, target_pct: 2 },
  { ticker: 'SOFI', tier: 3, target_pct: 1 },
  { ticker: 'SE', tier: 3, target_pct: 2 },
  { ticker: 'DDOG', tier: 3, target_pct: 1 },
];

// Seed once: only if the table is empty, so user edits are never overwritten.
export function seedTargets(db: BetterSqlite3.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM targets').get() as { c: number }).c;
  if (count > 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO targets (ticker, tier, target_pct) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const t of TARGETS) insert.run(t.ticker, t.tier, t.target_pct);
  });
  tx();
}
