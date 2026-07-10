import db from '@/lib/db';
import { getCurrentPrice, getMultipleCurrentPrices } from '@/lib/services/prices';
import { convert } from '@/lib/services/fx';
import type { Transaction, PortfolioHolding, Account } from '@/lib/types';

// NGX (Nigerian, NGN) is tracked in isolation: it is deliberately kept OUT of
// the multi-currency aggregate ('all') figures so it's never merged into the
// EUR/USD totals, holdings, P/L or deposited. It stays fully visible on its own
// via ?account=ngx. Any account in this currency is excluded from aggregates.
const ISOLATED_CURRENCY = 'NGN';
// SQL fragment (safe: hardcoded constant) that drops isolated-currency accounts
// from an aggregate query joined to `accounts a`.
const AGG_CCY_FILTER = `AND a.currency != '${ISOLATED_CURRENCY}'`;

// --- FIFO lot tracking ---

interface Lot {
  date: string;
  remaining_qty: number;
  price: number;
}

interface FIFOResult {
  quantity: number;
  avg_cost: number;
  cost_basis: number;
  realised_gain: number;
}

export function computeFIFO(transactions: (Pick<Transaction, 'date' | 'type' | 'quantity' | 'price_per_unit'> & { commission?: number | null })[]): FIFOResult {
  const lots: Lot[] = [];
  let realisedGain = 0;

  // Process in date order; buys before sells on the same date
  const sorted = [...transactions].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    if (a.type === 'buy' && b.type === 'sell') return -1;
    if (a.type === 'sell' && b.type === 'buy') return 1;
    return 0;
  });

  for (const tx of sorted) {
    if (tx.type === 'buy' && tx.quantity && tx.price_per_unit) {
      // Buy commission is part of the lot's cost basis
      const unitCost = tx.price_per_unit + (tx.commission || 0) / tx.quantity;
      lots.push({ date: tx.date, remaining_qty: tx.quantity, price: unitCost });
    } else if (tx.type === 'sell' && tx.quantity && tx.price_per_unit) {
      let toSell = tx.quantity;
      for (const lot of lots) {
        if (toSell <= 0) break;
        if (lot.remaining_qty <= 0) continue;

        const consume = Math.min(lot.remaining_qty, toSell);
        realisedGain += consume * (tx.price_per_unit - lot.price);
        lot.remaining_qty -= consume;
        toSell -= consume;
      }
      // Sell commission reduces the realised gain
      realisedGain -= tx.commission || 0;
      if (toSell > 0.0001) {
        console.warn(`[FIFO] Sell exceeds holdings by ${toSell.toFixed(4)} units`);
      }
    }
  }

  // Compute remaining quantity and weighted average cost
  let totalQty = 0;
  let totalCost = 0;
  for (const lot of lots) {
    if (lot.remaining_qty > 0.0001) {
      totalQty += lot.remaining_qty;
      totalCost += lot.remaining_qty * lot.price;
    }
  }

  const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
  return { quantity: totalQty, avg_cost: avgCost, cost_basis: totalCost, realised_gain: realisedGain };
}

// --- Holdings ---

// Hoisted prepared statements (better-sqlite3 does not cache db.prepare calls)
const tickerMetaStmt = db.prepare('SELECT name, sector, industry, asset_type, market FROM ticker_metadata WHERE ticker = ?');
const tickerTxsStmt = db.prepare(
  `SELECT date, type, quantity, price_per_unit, commission
   FROM transactions
   WHERE ticker = ? AND account_id = ? AND type IN ('buy', 'sell')
   ORDER BY date`
);
const tradeCcyStmt = db.prepare(
  `SELECT currency FROM transactions WHERE ticker = ? AND account_id = ? AND type = 'buy' LIMIT 1`
);

export async function getHoldings(accountId?: string): Promise<PortfolioHolding[]> {
  const single = accountId && accountId !== 'all';
  // Aggregate view excludes the isolated (NGX) account entirely.
  const condition = single ? 'AND t.account_id = ?' : AGG_CCY_FILTER;
  const params: string[] = single ? [accountId] : [];

  const tickers = db.prepare(
    `SELECT DISTINCT t.ticker, t.account_id, a.currency as account_currency
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.type IN ('buy', 'sell') AND t.ticker IS NOT NULL ${condition}`
  ).all(...params) as { ticker: string; account_id: string; account_currency: string }[];

  // Phase 1: compute FIFO for all tickers (pure DB, fast)
  interface HeldPosition {
    ticker: string; account_id: string; account_currency: string;
    tradeCcy: string; fifo: FIFOResult;
  }
  const held: HeldPosition[] = [];

  for (const { ticker, account_id, account_currency } of tickers) {
    const txs = tickerTxsStmt.all(ticker, account_id) as Pick<Transaction, 'date' | 'type' | 'quantity' | 'price_per_unit' | 'commission'>[];

    const fifo = computeFIFO(txs);
    if (fifo.quantity <= 0.0001) continue;

    const tradeCcy = (tradeCcyStmt.get(ticker, account_id) as { currency: string } | undefined)?.currency || account_currency;

    held.push({ ticker, account_id, account_currency, tradeCcy, fifo });
  }

  // Phase 2: fetch all prices in parallel
  const uniqueTickers = [...new Set(held.map(h => h.ticker))];
  const priceResults = await getMultipleCurrentPrices(uniqueTickers);
  const priceMap = new Map(priceResults.map(p => [p.ticker, p]));

  // Aggregate view: all holdings are converted to USD so they can be summed
  // and compared (account currencies span EUR/USD/NGN)
  const aggregate = !accountId || accountId === 'all';

  // Pre-fetch FX rates we'll need
  const fxPairs = new Set<string>();
  for (const h of held) {
    const pr = priceMap.get(h.ticker);
    const priceCcy = pr?.currency || 'USD';
    if (priceCcy !== h.tradeCcy) fxPairs.add(`${priceCcy}>${h.tradeCcy}`);
    if (h.tradeCcy !== h.account_currency) fxPairs.add(`${h.tradeCcy}>${h.account_currency}`);
    if (priceCcy !== h.account_currency) fxPairs.add(`${priceCcy}>${h.account_currency}`);
    if (aggregate && h.account_currency !== 'USD') fxPairs.add(`${h.account_currency}>USD`);
  }
  const fxCache = new Map<string, number>();
  await Promise.all([...fxPairs].map(async pair => {
    const [from, to] = pair.split('>');
    fxCache.set(pair, await convert(1, from, to));
  }));
  const fx = (amount: number, from: string, to: string) =>
    from === to ? amount : amount * (fxCache.get(`${from}>${to}`) ?? 1);

  // Phase 3: assemble holdings
  const holdings: PortfolioHolding[] = [];

  for (const { ticker, account_id, account_currency, tradeCcy, fifo } of held) {
    const priceResult = priceMap.get(ticker)!;
    const rawPrice = priceResult.price ?? 0;
    const priceCurrency = priceResult.currency || 'USD';

    const priceInTradeCcy = fx(rawPrice, priceCurrency, tradeCcy);
    const nativeMV = fifo.quantity * priceInTradeCcy;
    const nativePL = nativeMV - fifo.cost_basis;
    const unrealisedGain = fx(nativePL, tradeCcy, account_currency);

    const currentPrice = fx(rawPrice, priceCurrency, account_currency);
    const marketValue = fifo.quantity * currentPrice;
    const costBasisAcct = marketValue - unrealisedGain;
    const unrealisedGainPct = costBasisAcct > 0 ? (unrealisedGain / costBasisAcct) * 100 : 0;

    let dayGain = 0;
    const dayGainPct = priceResult.changePct ?? 0;
    if (priceResult.change != null) {
      dayGain = fx(fifo.quantity * priceResult.change, priceCurrency, account_currency);
    }

    const meta = tickerMetaStmt.get(ticker) as { name: string | null; sector: string | null; industry: string | null; asset_type: string | null; market: string | null } | undefined;

    // avg_cost is computed in the trade currency — express it in the account
    // currency like every other money field on this holding
    const avgCostAcct = fx(fifo.avg_cost, tradeCcy, account_currency);

    // In the aggregate view convert everything to USD so rows are summable
    const display = (v: number) => (aggregate ? fx(v, account_currency, 'USD') : v);

    holdings.push({
      ticker, name: meta?.name || null, sector: meta?.sector || null,
      industry: meta?.industry || null, asset_type: meta?.asset_type || null,
      market: meta?.market || null,
      account_id, quantity: fifo.quantity, avg_cost: display(avgCostAcct),
      cost_basis: display(costBasisAcct), current_price: display(currentPrice),
      market_value: display(marketValue), unrealised_gain: display(unrealisedGain),
      unrealised_gain_pct: unrealisedGainPct, day_gain: display(dayGain),
      day_gain_pct: dayGainPct, allocation_pct: 0,
      currency: aggregate ? 'USD' : account_currency,
    });
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.market_value, 0);
  if (totalValue > 0) {
    for (const h of holdings) {
      h.allocation_pct = (h.market_value / totalValue) * 100;
    }
  }

  return holdings;
}

// --- Cash Balance ---

export async function getCashBalance(accountId: string): Promise<number> {
  const account = db.prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId) as { currency: string } | undefined;
  if (!account) return 0;

  // Net cash movement per transaction currency, so a USD-priced buy in a EUR
  // account is converted instead of being subtracted 1:1 from EUR deposits
  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(currency, ''), ?) as ccy,
            COALESCE(SUM(CASE type
              WHEN 'deposit' THEN amount
              WHEN 'withdrawal' THEN -amount
              WHEN 'dividend' THEN amount
              WHEN 'buy' THEN -(quantity * price_per_unit + commission)
              WHEN 'sell' THEN quantity * price_per_unit - commission
            END), 0) as total
     FROM transactions
     WHERE account_id = ?
     GROUP BY ccy`
  ).all(account.currency, accountId) as { ccy: string; total: number }[];

  let balance = 0;
  for (const row of rows) {
    balance += await convert(row.total, row.ccy, account.currency);
  }
  return balance;
}

// --- Portfolio Value ---

export async function getPortfolioValue(accountId: string): Promise<{ value: number; currency: string; holdings_value: number; cash: number }> {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Account | undefined;
  if (!account) throw new Error(`Account not found: ${accountId}`);

  const holdings = await getHoldings(accountId);
  const holdingsValue = holdings.reduce((sum, h) => sum + h.market_value, 0);

  const trackCash = account.track_cash !== 0;
  const cash = trackCash ? await getCashBalance(accountId) : 0;

  return {
    value: holdingsValue + cash,
    currency: account.currency,
    holdings_value: holdingsValue,
    cash,
  };
}

// --- Aggregate Value ---

export interface AccountValue {
  account_id: string;
  name: string;
  currency: string;
  value: number;
  value_eur: number;
  value_usd: number;
  holdings_value: number;
  cash: number; // in the account's currency
  cash_usd: number;
}

export interface AggregateValue {
  total_eur: number;
  total_usd: number;
  accounts: AccountValue[];
}

export async function getAggregateValue(): Promise<AggregateValue> {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY name').all() as Account[];
  const accountValues: AccountValue[] = [];
  let totalEur = 0;
  let totalUsd = 0;

  for (const account of accounts) {
    const pv = await getPortfolioValue(account.id);
    const valueEur = await convert(pv.value, account.currency, 'EUR');
    const valueUsd = await convert(pv.value, account.currency, 'USD');
    const cashUsd = await convert(pv.cash, account.currency, 'USD');

    accountValues.push({
      account_id: account.id,
      name: account.name,
      currency: account.currency,
      value: pv.value,
      value_eur: valueEur,
      value_usd: valueUsd,
      holdings_value: pv.holdings_value,
      cash: pv.cash,
      cash_usd: cashUsd,
    });

    // The isolated (NGX/NGN) account stays in the accounts list — so it's still
    // shown on its own — but is kept out of the merged EUR/USD totals.
    if (account.currency !== ISOLATED_CURRENCY) {
      totalEur += valueEur;
      totalUsd += valueUsd;
    }
  }

  return { total_eur: totalEur, total_usd: totalUsd, accounts: accountValues };
}

// --- Total Deposited ---

/**
 * Total deposited. Single account: in the account's currency.
 * Aggregate: converted to USD (deposits are in EUR, USD and NGN — a raw sum
 * would be meaningless).
 */
export async function getTotalDeposited(accountId?: string): Promise<number> {
  if (accountId && accountId !== 'all') {
    const account = db.prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId) as { currency: string } | undefined;
    const rows = db.prepare(
      `SELECT COALESCE(NULLIF(t.currency, ''), a.currency) as ccy, COALESCE(SUM(t.amount), 0) as total
       FROM transactions t JOIN accounts a ON t.account_id = a.id
       WHERE t.account_id = ? AND t.type = 'deposit'
       GROUP BY ccy`
    ).all(accountId) as { ccy: string; total: number }[];
    let total = 0;
    for (const row of rows) {
      total += await convert(row.total, row.ccy, account?.currency || row.ccy);
    }
    return total;
  }

  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(t.currency, ''), a.currency) as ccy, COALESCE(SUM(t.amount), 0) as total
     FROM transactions t JOIN accounts a ON t.account_id = a.id
     WHERE t.type = 'deposit' ${AGG_CCY_FILTER}
     GROUP BY ccy`
  ).all() as { ccy: string; total: number }[];
  let total = 0;
  for (const row of rows) {
    total += await convert(row.total, row.ccy, 'USD');
  }
  return total;
}

// --- Daily PnL ---

export interface DailyPnL {
  today: { amount: number; pct: number };
  yesterday: { amount: number; pct: number };
}

export async function getDailyPnL(accountId?: string): Promise<DailyPnL> {
  // Get current holdings and their prices
  const holdings = await getHoldings(accountId);

  // Holdings are valued in their account's currency — convert to USD when
  // aggregating across accounts
  const aggregate = !accountId || accountId === 'all';
  const fxCache = new Map<string, number>();
  const toDisplay = async (amount: number, ccy: string) => {
    if (!aggregate || ccy === 'USD') return amount;
    if (!fxCache.has(ccy)) fxCache.set(ccy, await convert(1, ccy, 'USD'));
    return amount * fxCache.get(ccy)!;
  };

  let todayChange = 0;
  let prevValue = 0;

  for (const h of holdings) {
    // Use regularMarketChange from the price service if we had it cached
    // For now, approximate: day change = current_price - previous_close
    // This is a simplified version — will improve with daily snapshots
    todayChange += await toDisplay(h.day_gain, h.currency);
    prevValue += await toDisplay(h.market_value - h.day_gain, h.currency);
  }

  const todayPct = prevValue > 0 ? (todayChange / prevValue) * 100 : 0;

  // Yesterday's change — would need historical snapshots for accuracy
  // Returning 0 for now as placeholder
  return {
    today: { amount: todayChange, pct: todayPct },
    yesterday: { amount: 0, pct: 0 },
  };
}

// --- All-time P/L (realised + unrealised + dividends) ---

export interface AllTimePnL {
  unrealised: number;
  realised: number;
  dividends: number;
  total: number;
  total_pct: number | null;
  cost_basis: number; // cost basis of current open positions (display ccy) — the % denominator
}

/**
 * All-time P/L. Single account: in the account's currency.
 * Aggregate: converted to USD.
 */
export async function getAllTimePnL(accountId?: string): Promise<AllTimePnL> {
  const aggregate = !accountId || accountId === 'all';
  // Aggregate view excludes the isolated (NGX) account from realised,
  // unrealised, cost basis and dividends alike (this condition feeds both).
  const condition = aggregate ? AGG_CCY_FILTER : 'AND t.account_id = ?';
  const params: string[] = aggregate ? [] : [accountId];

  // Display-currency conversion (USD for the aggregate view)
  const fxCache = new Map<string, number>();
  const toDisplay = async (amount: number, ccy: string) => {
    if (!aggregate || ccy === 'USD') return amount;
    if (!fxCache.has(ccy)) fxCache.set(ccy, await convert(1, ccy, 'USD'));
    return amount * fxCache.get(ccy)!;
  };

  // Get all tickers with buy/sell transactions
  const tickers = db.prepare(
    `SELECT DISTINCT t.ticker, t.account_id, a.currency as account_currency
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.type IN ('buy', 'sell') AND t.ticker IS NOT NULL ${condition}`
  ).all(...params) as { ticker: string; account_id: string; account_currency: string }[];

  let totalRealised = 0;
  let totalUnrealised = 0;
  let totalCostBasis = 0;

  for (const { ticker, account_id, account_currency } of tickers) {
    const txs = tickerTxsStmt.all(ticker, account_id) as Pick<Transaction, 'date' | 'type' | 'quantity' | 'price_per_unit' | 'commission'>[];

    const fifo = computeFIFO(txs);

    // Determine trading currency
    const tradeCcy = (tradeCcyStmt.get(ticker, account_id) as { currency: string } | undefined)?.currency || account_currency;

    // Convert realised gain from native currency to account currency
    const realisedInAcct = tradeCcy !== account_currency
      ? await convert(fifo.realised_gain, tradeCcy, account_currency)
      : fifo.realised_gain;
    totalRealised += await toDisplay(realisedInAcct, account_currency);

    // For open positions, compute unrealised gain
    if (fifo.quantity > 0.0001) {
      const priceResult = await getCurrentPrice(ticker);
      const rawPrice = priceResult.price ?? 0;
      const priceCurrency = priceResult.currency || 'USD';

      // Convert price to native trading currency for P/L calculation
      const priceInTradeCcy = priceCurrency !== tradeCcy
        ? await convert(rawPrice, priceCurrency, tradeCcy)
        : rawPrice;

      const nativeMV = fifo.quantity * priceInTradeCcy;
      const nativePL = nativeMV - fifo.cost_basis;

      const unrealisedInAcct = tradeCcy !== account_currency
        ? await convert(nativePL, tradeCcy, account_currency)
        : nativePL;
      totalUnrealised += await toDisplay(unrealisedInAcct, account_currency);

      // Cost basis in account currency for percentage calculation
      const costInAcct = tradeCcy !== account_currency
        ? await convert(fifo.cost_basis, tradeCcy, account_currency)
        : fifo.cost_basis;
      totalCostBasis += await toDisplay(costInAcct, account_currency);
    }
  }

  // Sum dividends per currency and convert to the display currency
  const divRows = db.prepare(
    `SELECT COALESCE(NULLIF(t.currency, ''), a.currency) as ccy, COALESCE(SUM(t.amount), 0) as total
     FROM transactions t JOIN accounts a ON t.account_id = a.id
     WHERE t.type = 'dividend' ${condition}
     GROUP BY ccy`
  ).all(...params) as { ccy: string; total: number }[];
  let totalDividends = 0;
  if (aggregate) {
    for (const row of divRows) totalDividends += await toDisplay(row.total, row.ccy);
  } else {
    const account = db.prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId) as { currency: string } | undefined;
    for (const row of divRows) totalDividends += await convert(row.total, row.ccy, account?.currency || row.ccy);
  }

  const total = totalUnrealised + totalRealised + totalDividends;
  // Percentage is relative to the cost basis of open positions; without any
  // open positions there is no meaningful base — report null, not a division by 1
  const totalPct = totalCostBasis > 0.01 ? (total / totalCostBasis) * 100 : null;

  return {
    unrealised: totalUnrealised,
    realised: totalRealised,
    dividends: totalDividends,
    total,
    total_pct: totalPct,
    cost_basis: totalCostBasis,
  };
}
