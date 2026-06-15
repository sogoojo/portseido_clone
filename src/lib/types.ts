// --- Accounts ---

export interface Account {
  id: string;
  name: string;
  broker: string;
  currency: 'EUR' | 'USD' | 'NGN';
  track_cash: number;
  created_at: string;
}

// --- Transactions ---

export type TransactionType = 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend';

export interface Transaction {
  id: number;
  account_id: string;
  date: string;
  type: TransactionType;
  ticker: string | null;
  quantity: number | null;
  price_per_unit: number | null;
  amount: number | null;
  currency: string;
  commission: number;
  notes: string | null;
  created_at: string;
}

// --- Prices ---

export interface PriceData {
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
  currency: string;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
  fifty_day_avg?: number | null;
  two_hundred_day_avg?: number | null;
  fetched_at: string;
}

export interface FXRate {
  pair: string;
  date: string;
  rate: number;
  fetched_at: string;
}

// --- Ticker Metadata ---

export interface TickerMetadata {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  asset_type: 'equity' | 'crypto' | 'etf' | 'ngx_equity' | null;
  market: 'us' | 'eu' | 'ngx' | 'crypto' | null;
  currency: string | null;
  updated_at: string;
}

// A known ticker for the transaction-form picker — unioned from ticker
// metadata, the watchlist, prior transactions, and targets.
export interface TickerOption {
  ticker: string;
  name: string | null;
  market: string | null;
  currency: string | null;
  held: boolean; // appears in a buy/sell transaction (i.e. owned or once-owned)
}

// --- Portfolio ---

export interface PortfolioHolding {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  asset_type: string | null;
  market: string | null;
  account_id: string;
  quantity: number;
  avg_cost: number;
  cost_basis: number;
  current_price: number;
  market_value: number;
  unrealised_gain: number;
  unrealised_gain_pct: number;
  day_gain: number;
  day_gain_pct: number;
  allocation_pct: number;
  currency: string;
}

export interface PortfolioSummary {
  total_value_eur: number;
  total_value_usd: number;
  today_change: number;
  today_change_pct: number;
  yesterday_change: number;
  yesterday_change_pct: number;
  all_time_gain: number;
  all_time_gain_pct: number;
  total_deposited: number;
}

// --- Daily Summaries ---

export interface NewsArticle {
  source: 'yahoo' | 'brave';
  title: string;
  url: string;
  publisher: string;
  published_at: string;
  snippet?: string;
}

export interface RatingChange {
  date: string;          // ISO date of the rating action
  firm: string;
  from_grade: string;
  to_grade: string;
  action: string;        // up | down | init | main | reit
}

export interface RecTrendPoint {
  period: string;        // 0m | -1m | -2m | -3m
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface EarningsTrendPoint {
  period: string;        // 0q | +1q | 0y | +1y | +5y
  growth: number | null; // estimated EPS growth (fraction)
  eps_up_30d: number | null;   // analysts revising EPS up, last 30d
  eps_down_30d: number | null; // analysts revising EPS down, last 30d
}

export interface DailySummary {
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
  currency: string;
  news: NewsArticle[];
  // Free structured analyst/fundamental signals
  recommendation_key: string | null;
  recommendation_mean: number | null;
  analyst_count: number | null;
  target_mean: number | null;
  target_high: number | null;
  target_low: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  beta: number | null;
  short_ratio: number | null;
  fifty_two_week_change: number | null;
  earnings_surprise_pct: number | null;
  insider_net_shares: number | null;
  rating_changes: RatingChange[];
  recommendation_trend: RecTrendPoint[];
  earnings_trend: EarningsTrendPoint[];
  fetched_at: string;
}

export interface WatchlistItem {
  ticker: string;
  name: string | null;
  target_entry: number | null;
  tier: number | null;
  notes: string | null;
  added_at: string;
}

export type BuySignal = 'strong_buy' | 'buy' | 'watch' | 'avoid' | 'hold' | 'none';
export type TrendState = 'uptrend' | 'downtrend' | 'neutral' | 'unknown';
export type ThesisState = 'improving' | 'stable' | 'weakening' | 'unknown';

export interface WatchlistRow extends WatchlistItem {
  price: number | null;
  currency: string;
  dynamic_target: number | null;   // blended fair entry: avg(200DMA-5%, analystTarget-20%)
  effective_target: number | null; // dynamic_target, or manual target_entry as fallback
  target_basis: 'dynamic' | 'fixed' | 'none';
  distance: number | null;         // (effective_target - price) / price
  signal: BuySignal;               // thesis-aware verdict
  cheapness: BuySignal;            // raw cheap-vs-fair grade before knife/thesis
  fifty_two_week_high: number | null;
  pct_from_high: number | null;    // (price - 52wHigh) / 52wHigh
  trend: TrendState;               // from 50/200-day MA stack
  knife: boolean;                  // trend-based: downtrend + near 52w low
  thesis: ThesisState;             // from next-year EPS revision momentum
  analyst_upside: number | null;   // (consensus target - price) / price, if covered
  recommendation_key: string | null;
  ytd_change: number | null;       // (price - prior-year close) / prior-year close
  stale: boolean;
}

export interface TargetRow {
  ticker: string;
  tier: number | null;
  target_pct: number;
}

export type RebalanceStatus = 'underweight' | 'on_target' | 'overweight' | 'untracked';

export interface RebalanceRow {
  ticker: string;
  name: string | null;
  tier: number | null;
  value_eur: number;
  current_pct: number;
  target_pct: number | null;
  gap: number | null;              // target_pct - current_pct (percentage points)
  status: RebalanceStatus;
  priority: string;                // High | Medium | Low | Full | Add | -
}

export interface RebalanceResult {
  total_eur: number;
  rows: RebalanceRow[];
}

// --- API Response ---

export type ApiResponse<T> = { data: T } | { error: string; message: string };
