import db from '@/lib/db';
import { getHoldings } from './portfolio';
import { convert } from './fx';
import type { Account, TargetRow, RebalanceRow, RebalanceResult, RebalanceStatus } from '@/lib/types';

// --- Target CRUD ---

export function getTargets(): TargetRow[] {
  return db.prepare('SELECT ticker, tier, target_pct FROM targets ORDER BY tier, target_pct DESC').all() as TargetRow[];
}

export function upsertTarget(ticker: string, tier: number | null, targetPct: number): void {
  db.prepare(
    `INSERT INTO targets (ticker, tier, target_pct) VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET tier = excluded.tier, target_pct = excluded.target_pct`
  ).run(ticker, tier, targetPct);
}

export function deleteTarget(ticker: string): void {
  db.prepare('DELETE FROM targets WHERE ticker = ?').run(ticker);
}

// --- Rebalancing ---

const TIER_PRIORITY: Record<number, string> = { 1: 'High', 2: 'Medium', 3: 'Low' };

const tickerNameStmt = db.prepare('SELECT name FROM ticker_metadata WHERE ticker = ?');

function classify(gap: number | null): RebalanceStatus {
  if (gap == null) return 'untracked';
  if (gap > 0.5) return 'underweight';
  if (gap < -0.5) return 'overweight';
  return 'on_target';
}

// Aggregate current allocation per ticker across ALL accounts, normalised to EUR
// (accounts span EUR/USD/NGN), then compare to per-ticker target weights.
export async function computeRebalance(): Promise<RebalanceResult> {
  const accounts = db.prepare('SELECT * FROM accounts').all() as Account[];

  const valueByTicker = new Map<string, number>();
  let totalEur = 0;
  for (const account of accounts) {
    const holdings = await getHoldings(account.id);
    for (const h of holdings) {
      const eur = await convert(h.market_value, h.currency, 'EUR');
      totalEur += eur;
      valueByTicker.set(h.ticker, (valueByTicker.get(h.ticker) ?? 0) + eur);
    }
  }

  const targets = getTargets();
  const targetByTicker = new Map(targets.map(t => [t.ticker, t]));

  // Union of held tickers and targeted tickers
  const tickers = new Set<string>([...valueByTicker.keys(), ...targetByTicker.keys()]);

  const rows: RebalanceRow[] = [];
  for (const ticker of tickers) {
    const valueEur = valueByTicker.get(ticker) ?? 0;
    const currentPct = totalEur > 0 ? (valueEur / totalEur) * 100 : 0;
    const target = targetByTicker.get(ticker);
    const targetPct = target ? target.target_pct : null;
    const tier = target?.tier ?? null;
    const gap = targetPct != null ? targetPct - currentPct : null;
    const status = classify(gap);

    let priority = '-';
    if (targetPct != null) {
      if (status === 'underweight') {
        priority = tier != null ? (TIER_PRIORITY[tier] ?? 'Add') : 'Add';
      } else {
        priority = 'Full';
      }
    }

    const meta = tickerNameStmt.get(ticker) as { name: string | null } | undefined;

    rows.push({
      ticker, name: meta?.name ?? null, tier,
      value_eur: valueEur, current_pct: currentPct,
      target_pct: targetPct, gap, status, priority,
    });
  }

  // Most underweight first; untracked (no target) sink to the bottom.
  rows.sort((a, b) => {
    if (a.gap == null && b.gap == null) return b.value_eur - a.value_eur;
    if (a.gap == null) return 1;
    if (b.gap == null) return -1;
    return b.gap - a.gap;
  });

  return { total_eur: totalEur, rows };
}
