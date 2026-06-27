import db from '@/lib/db';
import { getMultipleCurrentPrices } from '@/lib/services/prices';
import { getLatestSummaries } from '@/lib/services/summaries';
import type {
  Thesis,
  ThesisEvaluated,
  ThesisTrigger,
  EvaluatedTrigger,
  ThesisRole,
  DailySummary,
} from '@/lib/types';

interface ThesisRow {
  ticker: string;
  role: string | null;
  thesis: string | null;
  target_weight: number | null;
  triggers: string;
  updated_at: string;
}

function rowToThesis(row: ThesisRow): Thesis {
  let triggers: ThesisTrigger[] = [];
  try {
    const parsed = JSON.parse(row.triggers || '[]');
    if (Array.isArray(parsed)) triggers = parsed;
  } catch {
    /* corrupt JSON — treat as no triggers */
  }
  return {
    ticker: row.ticker,
    role: (row.role as ThesisRole | null) ?? null,
    thesis: row.thesis,
    target_weight: row.target_weight,
    triggers,
    updated_at: row.updated_at,
  };
}

export function listTheses(): Thesis[] {
  const rows = db.prepare('SELECT * FROM theses ORDER BY ticker').all() as ThesisRow[];
  return rows.map(rowToThesis);
}

export function getThesis(ticker: string): Thesis | null {
  const row = db.prepare('SELECT * FROM theses WHERE ticker = ?').get(ticker) as ThesisRow | undefined;
  return row ? rowToThesis(row) : null;
}

export function upsertThesis(input: {
  ticker: string;
  role?: ThesisRole | null;
  thesis?: string | null;
  target_weight?: number | null;
  triggers?: ThesisTrigger[];
}): Thesis {
  const ticker = input.ticker.toUpperCase();
  db.prepare(
    `INSERT INTO theses (ticker, role, thesis, target_weight, triggers, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ticker) DO UPDATE SET
       role = excluded.role,
       thesis = excluded.thesis,
       target_weight = excluded.target_weight,
       triggers = excluded.triggers,
       updated_at = datetime('now')`
  ).run(
    ticker,
    input.role ?? null,
    input.thesis ?? null,
    input.target_weight ?? null,
    JSON.stringify(input.triggers ?? [])
  );
  return getThesis(ticker)!;
}

export function deleteThesis(ticker: string): void {
  db.prepare('DELETE FROM theses WHERE ticker = ?').run(ticker);
}

// ---- trigger evaluation ----

export interface TriggerContext {
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  summary: DailySummary | null;
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(2);
}

/**
 * Pure: has this trigger's condition fired right now? `evaluatable` is false for
 * manual triggers (the user owns their state) and for auto triggers whose data
 * is missing. Exported for unit tests.
 */
export function evaluateTrigger(t: ThesisTrigger, ctx: TriggerContext): EvaluatedTrigger {
  const out = (evaluatable: boolean, fired = false, detail: string | null = null): EvaluatedTrigger => ({
    ...t,
    evaluatable,
    fired,
    detail,
  });

  if (t.kind === 'manual') return out(false, !!t.fired, null);

  const { price, ma50, ma200, summary } = ctx;
  switch (t.metric) {
    case 'below_50d':
      if (price == null || ma50 == null) return out(false);
      return out(true, price < ma50, `$${fmt(price)} vs 50d $${fmt(ma50)}`);
    case 'below_200d':
      if (price == null || ma200 == null) return out(false);
      return out(true, price < ma200, `$${fmt(price)} vs 200d $${fmt(ma200)}`);
    case 'price_below':
      if (price == null || t.param == null) return out(false);
      return out(true, price < t.param, `$${fmt(price)} vs $${fmt(t.param)}`);
    case 'earnings_miss': {
      const s = summary?.earnings_surprise_pct;
      if (s == null) return out(false);
      return out(true, s < -0.05, `${(s * 100).toFixed(1)}% EPS surprise`);
    }
    case 'eps_revisions_down': {
      const pts = (summary?.earnings_trend ?? []).filter(
        (p) => (p.period === '+1q' || p.period === '+1y') && p.eps_up_30d != null && p.eps_down_30d != null
      );
      if (pts.length === 0) return out(false);
      const up = pts.reduce((a, p) => a + (p.eps_up_30d ?? 0), 0);
      const down = pts.reduce((a, p) => a + (p.eps_down_30d ?? 0), 0);
      return out(true, down > up, `fwd revisions ${up}↑ / ${down}↓`);
    }
    case 'analyst_downgrade': {
      const changes = summary?.rating_changes ?? [];
      if (changes.length === 0) return out(false);
      const latest = [...changes].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const fired = latest.action === 'down';
      return out(true, fired, fired ? `${latest.firm}: ${latest.from_grade}→${latest.to_grade}` : 'no recent downgrade');
    }
    default:
      return out(false);
  }
}

function evaluateAll(thesis: Thesis, ctx: TriggerContext): ThesisEvaluated {
  const evaluated = thesis.triggers.map((t) => evaluateTrigger(t, ctx));
  return {
    ...thesis,
    evaluated,
    firedCount: evaluated.filter((e) => e.fired).length,
    triggerCount: evaluated.length,
  };
}

const EMPTY_CTX: TriggerContext = { price: null, ma50: null, ma200: null, summary: null };

async function buildContexts(tickers: string[]): Promise<Map<string, TriggerContext>> {
  const out = new Map<string, TriggerContext>();
  if (tickers.length === 0) return out;
  const quotes = await getMultipleCurrentPrices(tickers);
  const summaries = getLatestSummaries(tickers);
  const summaryByTicker = new Map(summaries.map((s) => [s.ticker, s]));
  for (const t of tickers) {
    const q = quotes.find((x) => x.ticker === t);
    out.set(t, {
      price: q?.price ?? null,
      ma50: q?.fiftyDayAverage ?? null,
      ma200: q?.twoHundredDayAverage ?? null,
      summary: summaryByTicker.get(t) ?? null,
    });
  }
  return out;
}

/** All theses (or a subset) with each trigger evaluated against live data. */
export async function evaluateTheses(tickers?: string[]): Promise<ThesisEvaluated[]> {
  const theses =
    tickers && tickers.length
      ? tickers.map((t) => getThesis(t)).filter((x): x is Thesis => x != null)
      : listTheses();
  const ctxs = await buildContexts(theses.map((t) => t.ticker));
  return theses.map((t) => evaluateAll(t, ctxs.get(t.ticker) ?? EMPTY_CTX));
}

export async function evaluateThesis(ticker: string): Promise<ThesisEvaluated | null> {
  const t = getThesis(ticker);
  if (!t) return null;
  const ctxs = await buildContexts([ticker]);
  return evaluateAll(t, ctxs.get(ticker) ?? EMPTY_CTX);
}
