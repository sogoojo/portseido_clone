import { getHistoricalPrices, getMultipleCurrentPrices } from '@/lib/services/prices';
import { getHoldings } from '@/lib/services/portfolio';

/**
 * Layer 1 — sector/theme rotation + per-holding risk (RAG).
 *
 * Everything here is derived from daily closes (cached in price_cache via
 * getHistoricalPrices). No new tables. Returns are unitless ratios, so no FX
 * is needed — a theme's strength is measured against the market (SPY), not in
 * any currency.
 */

export type ThemeGroup = 'Sector' | 'Theme';
export type ThemeKind = 'etf' | 'basket';
export type Stage = 'early' | 'extended' | 'late' | 'weak';

interface ThemeDef {
  key: string;
  name: string;
  group: ThemeGroup;
  kind: ThemeKind;
  members: string[]; // ETF proxy (single) or equal-weighted basket — drives the ranking
  stocks?: string[]; // representative names for the drill-down (ETF-proxy sectors only)
}

/**
 * The watchable universe. EDIT THIS LIST to add/remove what you track.
 * - `etf`: one liquid ETF stands in for the whole sector/theme.
 * - `basket`: micro-themes with no clean ETF — equal-weighted member returns.
 *   This is what surfaces e.g. "memory is running" before a single name lands
 *   on your radar.
 */
export const THEMES: ThemeDef[] = [
  // Broad GICS sectors (ETF proxies)
  { key: 'tech', name: 'Technology', group: 'Sector', kind: 'etf', members: ['XLK'], stocks: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL'] },
  { key: 'semis', name: 'Semiconductors', group: 'Sector', kind: 'etf', members: ['SMH'], stocks: ['NVDA', 'AVGO', 'TSM', 'AMD', 'MU'] },
  { key: 'software', name: 'Software', group: 'Sector', kind: 'etf', members: ['IGV'] },
  { key: 'comms', name: 'Communication Svcs', group: 'Sector', kind: 'etf', members: ['XLC'] },
  { key: 'discretionary', name: 'Consumer Disc.', group: 'Sector', kind: 'etf', members: ['XLY'] },
  { key: 'financials', name: 'Financials', group: 'Sector', kind: 'etf', members: ['XLF'] },
  { key: 'healthcare', name: 'Healthcare', group: 'Sector', kind: 'etf', members: ['XLV'] },
  { key: 'energy', name: 'Energy', group: 'Sector', kind: 'etf', members: ['XLE'] },
  { key: 'industrials', name: 'Industrials', group: 'Sector', kind: 'etf', members: ['XLI'], stocks: ['GE', 'CAT', 'RTX', 'UBER', 'HON'] },
  { key: 'utilities', name: 'Utilities', group: 'Sector', kind: 'etf', members: ['XLU'] },
  { key: 'materials', name: 'Materials', group: 'Sector', kind: 'etf', members: ['XLB'] },
  { key: 'staples', name: 'Consumer Staples', group: 'Sector', kind: 'etf', members: ['XLP'] },

  // Thematic ETFs
  { key: 'cyber', name: 'Cybersecurity', group: 'Theme', kind: 'etf', members: ['CIBR'], stocks: ['CRWD', 'PANW', 'FTNT', 'ZS', 'NET'] },
  { key: 'cloud', name: 'Cloud', group: 'Theme', kind: 'etf', members: ['SKYY'] },
  { key: 'fintech', name: 'Fintech', group: 'Theme', kind: 'etf', members: ['FINX'] },
  { key: 'biotech', name: 'Biotech', group: 'Theme', kind: 'etf', members: ['XBI'], stocks: ['VRTX', 'REGN', 'GILD', 'ALNY', 'MRNA'] },
  { key: 'robotics', name: 'Robotics / AI', group: 'Theme', kind: 'etf', members: ['BOTZ'] },
  { key: 'uranium', name: 'Uranium / Nuclear', group: 'Theme', kind: 'etf', members: ['URA'] },

  // Micro-theme baskets (no clean ETF) — equal-weighted
  { key: 'memory', name: 'Memory / HBM', group: 'Theme', kind: 'basket', members: ['MU', 'WDC', 'STX'] },
  { key: 'ai-compute', name: 'AI Compute / Neocloud', group: 'Theme', kind: 'basket', members: ['NBIS', 'NVDA', 'VRT', 'SMCI'] },
  { key: 'quantum', name: 'Quantum', group: 'Theme', kind: 'basket', members: ['IONQ', 'RGTI', 'QBTS'] },
  { key: 'power', name: 'AI Power / Grid', group: 'Theme', kind: 'basket', members: ['GEV', 'ETN', 'PWR', 'VST'] },
];

const BENCHMARK = 'SPY';

// Trading-day windows (~21 per month)
const W5 = 5;
const W1 = 21;
const W3 = 63;
const W6 = 126;

// ---- pure math helpers (exported for tests) ----

/** Total return over the last `n` trading days, or null if too little data. */
export function retDaysAgo(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - n];
  if (!past) return null;
  return last / past - 1;
}

/** Simple moving average of the last `n` closes, or null if too few. */
export function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function rs(themeRet: number | null, spyRet: number | null): number | null {
  return themeRet != null && spyRet != null ? themeRet - spyRet : null;
}

/** How far into a move a leading theme is, from its extension above the 50d MA. */
export function stageOf(score: number, ext: number | null): Stage {
  if (score <= 0) return 'weak';
  if (ext == null) return 'early';
  if (ext > 0.15) return 'late';
  if (ext > 0.07) return 'extended';
  return 'early';
}

// ---- data fetch ----

/** Run `fn` over `items` with at most `n` in flight. */
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const HISTORY_DAYS = 430; // ~295 trading days — enough for 6m return + 200d MA

async function fetchCloses(ticker: string): Promise<number[]> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - HISTORY_DAYS * 86400000);
    const rows = await getHistoricalPrices(ticker, from, to);
    return rows.map((r) => r.close).filter((c) => typeof c === 'number' && c > 0);
  } catch {
    return [];
  }
}

/**
 * Daily closes per ticker from price_cache. Freshness is the nightly cron's job
 * (refreshRotationUniverse appends each day's end-of-day bar), so a page visit is
 * a fast cache read — no re-pulling a year of bars.
 */
async function loadCloses(tickers: string[]): Promise<Map<string, number[]>> {
  const list = await mapPool(tickers, 6, fetchCloses);
  const out = new Map<string, number[]>();
  tickers.forEach((t, i) => out.set(t, list[i]));
  return out;
}

/** Tickers a theme touches: its ranking members plus any drill-down stocks. */
function themeTickers(t: ThemeDef): string[] {
  return [...t.members, ...(t.stocks ?? [])];
}

/** Everything the Radar tracks: benchmark + theme members/stocks + holdings. */
export async function getRotationUniverse(): Promise<string[]> {
  const holdings = await getHoldings();
  const held = holdings.filter((h) => h.ticker && h.quantity > 0).map((h) => h.ticker);
  return [...new Set([BENCHMARK, ...THEMES.flatMap(themeTickers), ...held])];
}

/**
 * Nightly job (run from the daily-summaries cron, after US/EU close): make sure
 * the long history is backfilled, then append today's end-of-day bar to
 * price_cache for every name. The quote path persists the EOD close, so this
 * grows a continuous daily history the Radar reads from.
 */
export async function refreshRotationUniverse(): Promise<{ universe: number; refreshed: number }> {
  const tickers = await getRotationUniverse();
  // Ensure ~14 months of history exists (one-time backfill; cache hits after).
  await loadCloses(tickers);
  // Write today's end-of-day bar for each ticker. Count only genuinely fresh
  // quotes (stale-cache fallbacks don't add a new bar).
  let refreshed = 0;
  try {
    const live = await getMultipleCurrentPrices(tickers);
    refreshed = live.filter((q) => q?.price != null && !q.stale).length;
  } catch {
    // Leave the cached history untouched if the batch quote fails.
  }
  return { universe: tickers.length, refreshed };
}

// ---- public API ----

/** Per-stock breakdown shown when a theme row is expanded. */
export interface Constituent {
  ticker: string;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  rs_3m: number | null; // 3-month return vs the S&P 500
  ext50: number | null; // extension above the 50-day MA (trend/stretch)
  stage: Stage;
}

export interface ThemeRotation {
  key: string;
  name: string;
  group: ThemeGroup;
  kind: ThemeKind;
  members: string[];
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  rs_1m: number | null;
  rs_3m: number | null;
  rs_6m: number | null;
  breadth: number | null; // fraction of members above their 50d MA
  ext50: number | null; // avg member extension above 50d MA
  score: number; // relative-strength blend (rank key)
  stage: Stage;
  constituents: Constituent[]; // per-member breakdown (drill-down)
}

interface SpyReturns {
  d5: number | null;
  d1: number | null;
  d3: number | null;
  d6: number | null;
}

/** Per-stock stats for the drill-down, same lens as the theme row. */
function memberStat(ticker: string, closes: number[], spy: SpyReturns): Constituent {
  const ret_5d = retDaysAgo(closes, W5);
  const ret_1m = retDaysAgo(closes, W1);
  const ret_3m = retDaysAgo(closes, W3);
  const ret_6m = retDaysAgo(closes, W6);
  const m50 = sma(closes, 50);
  const ext50 = m50 != null && closes.length > 0 ? closes[closes.length - 1] / m50 - 1 : null;
  const rs_1m = rs(ret_1m, spy.d1);
  const rs_3m = rs(ret_3m, spy.d3);
  const rs_6m = rs(ret_6m, spy.d6);
  const score = 0.3 * (rs_1m ?? 0) + 0.5 * (rs_3m ?? 0) + 0.2 * (rs_6m ?? 0);
  return { ticker, ret_5d, ret_1m, ret_3m, ret_6m, rs_3m, ext50, stage: stageOf(score, ext50) };
}

export async function computeRotation(): Promise<ThemeRotation[]> {
  const tickers = [...new Set([BENCHMARK, ...THEMES.flatMap(themeTickers)])];
  const closes = await loadCloses(tickers);

  const spy = closes.get(BENCHMARK) ?? [];
  const spyR: SpyReturns = {
    d5: retDaysAgo(spy, W5),
    d1: retDaysAgo(spy, W1),
    d3: retDaysAgo(spy, W3),
    d6: retDaysAgo(spy, W6),
  };

  const result: ThemeRotation[] = THEMES.map((t) => {
    // The ranking is driven by `members` (the ETF proxy, or the basket itself).
    const aggStats = t.members.map((m) => memberStat(m, closes.get(m) ?? [], spyR));
    // The drill-down uses representative `stocks` when given, else the members.
    const constituents = (t.stocks ?? t.members)
      .map((m) => memberStat(m, closes.get(m) ?? [], spyR))
      .sort((a, b) => (b.rs_3m ?? -Infinity) - (a.rs_3m ?? -Infinity));

    const ret_5d = avg(aggStats.map((s) => s.ret_5d));
    const ret_1m = avg(aggStats.map((s) => s.ret_1m));
    const ret_3m = avg(aggStats.map((s) => s.ret_3m));
    const ret_6m = avg(aggStats.map((s) => s.ret_6m));
    const ext50 = avg(aggStats.map((s) => s.ext50));

    // Breadth reads off the drill-down names (more telling than a single ETF).
    const aboveCount = constituents.filter((c) => c.ext50 != null && c.ext50 > 0).length;
    const breadth = constituents.length ? aboveCount / constituents.length : null;

    const rs_1m = rs(ret_1m, spyR.d1);
    const rs_3m = rs(ret_3m, spyR.d3);
    const rs_6m = rs(ret_6m, spyR.d6);
    const score = 0.3 * (rs_1m ?? 0) + 0.5 * (rs_3m ?? 0) + 0.2 * (rs_6m ?? 0);

    return {
      key: t.key,
      name: t.name,
      group: t.group,
      kind: t.kind,
      members: t.members,
      ret_5d,
      ret_1m,
      ret_3m,
      ret_6m,
      rs_1m,
      rs_3m,
      rs_6m,
      breadth,
      ext50,
      score,
      stage: stageOf(score, ext50),
      constituents,
    };
  });

  result.sort((a, b) => b.score - a.score);
  return result;
}
