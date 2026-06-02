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
  fetched_at: string;
}

export interface WatchlistItem {
  ticker: string;
  name: string | null;
  added_at: string;
}

// --- API Response ---

export type ApiResponse<T> = { data: T } | { error: string; message: string };
