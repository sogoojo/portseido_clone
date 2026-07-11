import type Database from 'better-sqlite3';

type TxType = 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend';

interface TradeRow {
  id: number;
  account_id: string;
  date: string;
  type: TxType;
  ticker: string;
  quantity: number;
  price_per_unit: number;
  amount: number | null;
  currency: string;
  commission: number | null;
  notes: string | null;
}

export interface InvalidTransaction {
  id: number;
  reasons: string[];
}

export interface AmountMismatch {
  id: number;
  account_id: string;
  ticker: string;
  recorded_amount: number;
  computed_amount: number;
  difference: number;
}

export interface OversellCandidate {
  id: number;
  account_id: string;
  ticker: string;
  date: string;
  quantity_sold: number;
  quantity_available: number;
  shortfall: number;
}

export interface SameDayTrade {
  id: number;
  type: 'buy' | 'sell';
  quantity: number;
  price_per_unit: number;
  currency: string;
  notes: string | null;
}

export interface ExactEconomicCandidate {
  account_id: string;
  date: string;
  type: string;
  ticker: string | null;
  quantity: number | null;
  price_per_unit: number | null;
  amount: number | null;
  currency: string;
  ids: number[];
  same_day_sequence: SameDayTrade[];
}

export type PriceMagnitudeMatch = 'recorded_matches_close' | 'recorded_matches_fx_converted_close' | 'ambiguous' | 'neither' | 'insufficient_data';

export interface TradePriceEvidence {
  id: number;
  date: string;
  type: 'buy' | 'sell';
  recorded_currency: string;
  recorded_price: number;
  close_date: string | null;
  close_currency: string | null;
  close_price: number | null;
  fx_rate: number | null;
  converted_close: number | null;
  recorded_to_close_ratio: number | null;
  recorded_to_converted_close_ratio: number | null;
  magnitude_match: PriceMagnitudeMatch;
}

export interface MixedCurrencyPosition {
  account_id: string;
  ticker: string;
  first_buy_currency: string;
  currencies: string[];
  trade_count: number;
  price_evidence: TradePriceEvidence[];
}

export interface IntegrityAuditReport {
  generated_at: string;
  database_path: string;
  read_only: true;
  thresholds: {
    amount_tolerance: number;
    price_magnitude_tolerance_pct: number;
    ambiguity_difference_pct: number;
    maximum_price_lookback_days: number;
  };
  summary: {
    transactions: number;
    invalid_transactions: number;
    amount_mismatches: number;
    oversell_candidates: number;
    exact_economic_candidates: number;
    mixed_currency_positions: number;
  };
  invalid_transactions: InvalidTransaction[];
  amount_mismatches: AmountMismatch[];
  oversell_candidates: OversellCandidate[];
  exact_economic_candidates: ExactEconomicCandidate[];
  mixed_currency_positions: MixedCurrencyPosition[];
}

const VALID_TYPES = new Set<TxType>(['buy', 'sell', 'deposit', 'withdrawal', 'dividend']);
const AMOUNT_TOLERANCE = 0.01;
const PRICE_MAGNITUDE_TOLERANCE = 0.15;
// If both hypotheses pass and their errors are within two percentage points,
// the cached evidence is not strong enough to prefer either currency label.
const AMBIGUITY_DIFFERENCE = 0.02;
const MAX_PRICE_LOOKBACK_DAYS = 7;

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function relativeDifference(actual: number, expected: number): number {
  return expected === 0 ? Number.POSITIVE_INFINITY : Math.abs(actual - expected) / Math.abs(expected);
}

function daysBetween(later: string, earlier: string): number {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000;
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function latestFxRate(db: Database.Database, from: string, to: string, date: string): number | null {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const pair = `${from.toUpperCase()}${to.toUpperCase()}`;
  const direct = db.prepare(
    'SELECT rate FROM fx_cache WHERE pair = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).get(pair, date) as { rate: number } | undefined;
  if (direct?.rate && direct.rate > 0) return direct.rate;

  const inversePair = `${to.toUpperCase()}${from.toUpperCase()}`;
  const inverse = db.prepare(
    'SELECT rate FROM fx_cache WHERE pair = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).get(inversePair, date) as { rate: number } | undefined;
  return inverse?.rate && inverse.rate > 0 ? 1 / inverse.rate : null;
}

function priceEvidence(db: Database.Database, trade: TradeRow): TradePriceEvidence {
  const close = db.prepare(
    `SELECT date, close, currency
     FROM price_cache
     WHERE ticker = ? AND date <= ?
     ORDER BY date DESC LIMIT 1`
  ).get(trade.ticker, trade.date) as { date: string; close: number; currency: string } | undefined;

  const usableClose = close && daysBetween(trade.date, close.date) <= MAX_PRICE_LOOKBACK_DAYS ? close : undefined;
  if (!usableClose || usableClose.close <= 0) {
    return {
      id: trade.id, date: trade.date, type: trade.type as 'buy' | 'sell',
      recorded_currency: trade.currency, recorded_price: trade.price_per_unit,
      close_date: null, close_currency: null, close_price: null, fx_rate: null,
      converted_close: null, recorded_to_close_ratio: null,
      recorded_to_converted_close_ratio: null, magnitude_match: 'insufficient_data',
    };
  }

  const fxRate = latestFxRate(db, usableClose.currency, trade.currency, trade.date);
  const convertedClose = fxRate == null ? null : usableClose.close * fxRate;
  const distinctCurrencyHypotheses = usableClose.currency.toUpperCase() !== trade.currency.toUpperCase();
  const rawRatio = trade.price_per_unit / usableClose.close;
  const convertedRatio = convertedClose && convertedClose > 0 ? trade.price_per_unit / convertedClose : null;
  const rawDifference = relativeDifference(trade.price_per_unit, usableClose.close);
  const convertedDifference = convertedClose == null
    ? Number.POSITIVE_INFINITY
    : relativeDifference(trade.price_per_unit, convertedClose);
  const rawPlausible = rawDifference <= PRICE_MAGNITUDE_TOLERANCE;
  const convertedPlausible = distinctCurrencyHypotheses && convertedDifference <= PRICE_MAGNITUDE_TOLERANCE;

  let magnitudeMatch: PriceMagnitudeMatch = 'neither';
  if (rawPlausible && convertedPlausible && Math.abs(rawDifference - convertedDifference) <= AMBIGUITY_DIFFERENCE) {
    magnitudeMatch = 'ambiguous';
  } else if (rawPlausible && convertedPlausible) {
    magnitudeMatch = rawDifference < convertedDifference
      ? 'recorded_matches_close'
      : 'recorded_matches_fx_converted_close';
  } else if (rawPlausible) {
    magnitudeMatch = 'recorded_matches_close';
  } else if (convertedPlausible) {
    magnitudeMatch = 'recorded_matches_fx_converted_close';
  }

  return {
    id: trade.id, date: trade.date, type: trade.type as 'buy' | 'sell',
    recorded_currency: trade.currency, recorded_price: trade.price_per_unit,
    close_date: usableClose.date, close_currency: usableClose.currency,
    close_price: round(usableClose.close), fx_rate: fxRate == null ? null : round(fxRate),
    converted_close: convertedClose == null ? null : round(convertedClose),
    recorded_to_close_ratio: round(rawRatio),
    recorded_to_converted_close_ratio: convertedRatio == null ? null : round(convertedRatio),
    magnitude_match: magnitudeMatch,
  };
}

export function runIntegrityAudit(db: Database.Database, databasePath = '(provided connection)'): IntegrityAuditReport {
  const rows = db.prepare('SELECT * FROM transactions ORDER BY date, id').all() as Array<TradeRow & { ticker: string | null }>;
  const invalidTransactions: InvalidTransaction[] = [];
  const amountMismatches: AmountMismatch[] = [];
  const trades: TradeRow[] = [];

  for (const row of rows) {
    const reasons: string[] = [];
    if (!VALID_TYPES.has(row.type)) reasons.push(`invalid type: ${row.type}`);
    if (!isIsoCalendarDate(row.date)) reasons.push('invalid date');
    if (!row.currency?.trim()) reasons.push('missing currency');
    if ((row.commission ?? 0) < 0) reasons.push('negative commission');

    if (row.type === 'buy' || row.type === 'sell') {
      if (!row.ticker) reasons.push('trade missing ticker');
      if (!(row.quantity > 0)) reasons.push('trade quantity must be positive');
      if (!(row.price_per_unit > 0)) reasons.push('trade price must be positive');
      if (row.ticker && row.quantity > 0 && row.price_per_unit > 0) {
        const trade = row as TradeRow;
        trades.push(trade);
        if (row.amount != null) {
          const computed = row.quantity * row.price_per_unit;
          if (Math.abs(row.amount - computed) > AMOUNT_TOLERANCE) {
            amountMismatches.push({
              id: row.id, account_id: row.account_id, ticker: row.ticker,
              recorded_amount: row.amount, computed_amount: round(computed),
              difference: round(row.amount - computed),
            });
          }
        }
      }
    } else if ((row.type === 'deposit' || row.type === 'withdrawal' || row.type === 'dividend') && !(row.amount != null && row.amount > 0)) {
      reasons.push(`${row.type} amount must be positive`);
    }
    if (reasons.length > 0) invalidTransactions.push({ id: row.id, reasons });
  }

  const balances = new Map<string, number>();
  const oversells: OversellCandidate[] = [];
  for (const trade of trades) {
    const key = `${trade.account_id}\u0000${trade.ticker}`;
    const available = balances.get(key) ?? 0;
    if (trade.type === 'buy') {
      balances.set(key, available + trade.quantity);
    } else {
      if (trade.quantity > available + 0.0001) {
        oversells.push({
          id: trade.id, account_id: trade.account_id, ticker: trade.ticker, date: trade.date,
          quantity_sold: trade.quantity, quantity_available: round(available),
          shortfall: round(trade.quantity - available),
        });
      }
      // A missing opening lot should flag this row, but must not create a
      // synthetic negative balance that exaggerates every later sell.
      balances.set(key, Math.max(0, available - trade.quantity));
    }
  }

  const duplicateGroups = db.prepare(
    `SELECT account_id, date, type, ticker, quantity, price_per_unit, amount, currency,
            GROUP_CONCAT(id) AS ids
     FROM transactions
     GROUP BY account_id, date, type, COALESCE(ticker, ''), COALESCE(quantity, -1),
              COALESCE(price_per_unit, -1), COALESCE(amount, -1), UPPER(currency)
     HAVING COUNT(*) > 1
     ORDER BY date, account_id, ticker`
  ).all() as Array<Omit<ExactEconomicCandidate, 'ids' | 'same_day_sequence'> & { ids: string }>;

  const exactCandidates = duplicateGroups.map(group => {
    const sequence = group.ticker ? db.prepare(
      `SELECT id, type, quantity, price_per_unit, currency, notes
       FROM transactions
       WHERE account_id = ? AND date = ? AND ticker = ? AND type IN ('buy', 'sell')
       ORDER BY id`
    ).all(group.account_id, group.date, group.ticker) as SameDayTrade[] : [];
    return { ...group, ids: group.ids.split(',').map(Number), same_day_sequence: sequence };
  });

  const mixedGroups = db.prepare(
    `SELECT account_id, ticker, COUNT(*) AS trade_count
     FROM transactions
     WHERE type IN ('buy', 'sell') AND ticker IS NOT NULL
     GROUP BY account_id, ticker
     HAVING COUNT(DISTINCT UPPER(currency)) > 1
     ORDER BY account_id, ticker`
  ).all() as Array<{ account_id: string; ticker: string; trade_count: number }>;

  const mixedPositions = mixedGroups.map(group => {
    const positionTrades = trades.filter(t => t.account_id === group.account_id && t.ticker === group.ticker);
    const firstBuy = positionTrades.find(t => t.type === 'buy');
    return {
      ...group,
      first_buy_currency: firstBuy?.currency ?? positionTrades[0]?.currency ?? '',
      currencies: [...new Set(positionTrades.map(t => t.currency.toUpperCase()))].sort(),
      price_evidence: positionTrades.map(t => priceEvidence(db, t)),
    };
  });

  return {
    generated_at: new Date().toISOString(), database_path: databasePath, read_only: true,
    thresholds: {
      amount_tolerance: AMOUNT_TOLERANCE,
      price_magnitude_tolerance_pct: PRICE_MAGNITUDE_TOLERANCE * 100,
      ambiguity_difference_pct: AMBIGUITY_DIFFERENCE * 100,
      maximum_price_lookback_days: MAX_PRICE_LOOKBACK_DAYS,
    },
    summary: {
      transactions: rows.length,
      invalid_transactions: invalidTransactions.length,
      amount_mismatches: amountMismatches.length,
      oversell_candidates: oversells.length,
      exact_economic_candidates: exactCandidates.length,
      mixed_currency_positions: mixedPositions.length,
    },
    invalid_transactions: invalidTransactions,
    amount_mismatches: amountMismatches,
    oversell_candidates: oversells,
    exact_economic_candidates: exactCandidates,
    mixed_currency_positions: mixedPositions,
  };
}
