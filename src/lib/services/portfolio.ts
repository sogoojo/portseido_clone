import db from '@/lib/db';
import { getCurrentPrice, getMultipleCurrentPrices } from '@/lib/services/prices';
import { convert } from '@/lib/services/fx';
import type { Transaction, PortfolioHolding, Account } from '@/lib/types';

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

export function computeFIFO(transactions: Pick<Transaction, 'date' | 'type' | 'quantity' | 'price_per_unit'>[]): FIFOResult {
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
      lots.push({ date: tx.date, remaining_qty: tx.quantity, price: tx.price_per_unit });
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

export async function getHoldings(accountId?: string): Promise<PortfolioHolding[]> {
  const condition = accountId && accountId !== 'all' ? 'AND t.account_id = ?' : '';
  const params: string[] = accountId && accountId !== 'all' ? [accountId] : [];

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
    const txs = db.prepare(
      `SELECT date, type, quantity, price_per_unit
       FROM transactions
       WHERE ticker = ? AND account_id = ? AND type IN ('buy', 'sell')
       ORDER BY date`
    ).all(ticker, account_id) as Pick<Transaction, 'date' | 'type' | 'quantity' | 'price_per_unit'>[];

    const fifo = computeFIFO(txs);
    if (fifo.quantity <= 0.0001) continue;

    const tradeCcy = (db.prepare(
      `SELECT currency FROM transactions WHERE ticker = ? AND account_id = ? AND type = 'buy' LIMIT 1`
    ).get(ticker, account_id) as { currency: string } | undefined)?.currency || account_currency;

    held.push({ ticker, account_id, account_currency, tradeCcy, fifo });
  }

  // Phase 2: fetch all prices in parallel
  const uniqueTickers = [...new Set(held.map(h => h.ticker))];
  const priceResults = await getMultipleCurrentPrices(uniqueTickers);
  const priceMap = new Map(priceResults.map(p => [p.ticker, p]));

  // Pre-fetch FX rates we'll need
  const fxPairs = new Set<string>();
  for (const h of held) {
    const pr = priceMap.get(h.ticker);
    const priceCcy = pr?.currency || 'USD';
    if (priceCcy !== h.tradeCcy) fxPairs.add(`${priceCcy}>${h.tradeCcy}`);
    if (h.tradeCcy !== h.account_currency) fxPairs.add(`${h.tradeCcy}>${h.account_currency}`);
    if (priceCcy !== h.account_currency) fxPairs.add(`${priceCcy}>${h.account_currency}`);
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

    const meta = db.prepare('SELECT name, sector, industry, asset_type, market FROM ticker_metadata WHERE ticker = ?').get(ticker) as { name: string | null; sector: string | null; industry: string | null; asset_type: string | null; market: string | null } | undefined;

    holdings.push({
      ticker, name: meta?.name || null, sector: meta?.sector || null,
      industry: meta?.industry || null, asset_type: meta?.asset_type || null,
      market: meta?.market || null,
      account_id, quantity: fifo.quantity, avg_cost: fifo.avg_cost,
      cost_basis: costBasisAcct, current_price: currentPrice,
      market_value: marketValue, unrealised_gain: unrealisedGain,
      unrealised_gain_pct: unrealisedGainPct, day_gain: dayGain,
      day_gain_pct: dayGainPct, allocation_pct: 0, currency: account_currency,
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

export function getCashBalance(accountId: string): number {
  const deposits = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'deposit'`
  ).get(accountId) as { total: number };

  const withdrawals = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'withdrawal'`
  ).get(accountId) as { total: number };

  const buyCosts = db.prepare(
    `SELECT COALESCE(SUM(quantity * price_per_unit + commission), 0) as total
     FROM transactions WHERE account_id = ? AND type = 'buy'`
  ).get(accountId) as { total: number };

  const sellProceeds = db.prepare(
    `SELECT COALESCE(SUM(quantity * price_per_unit - commission), 0) as total
     FROM transactions WHERE account_id = ? AND type = 'sell'`
  ).get(accountId) as { total: number };

  const dividends = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'dividend'`
  ).get(accountId) as { total: number };

  return deposits.total - withdrawals.total - buyCosts.total + sellProceeds.total + dividends.total;
}

// --- Portfolio Value ---

export async function getPortfolioValue(accountId: string): Promise<{ value: number; currency: string; holdings_value: number; cash: number }> {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Account | undefined;
  if (!account) throw new Error(`Account not found: ${accountId}`);

  const holdings = await getHoldings(accountId);
  const holdingsValue = holdings.reduce((sum, h) => sum + h.market_value, 0);

  const trackCash = account.track_cash !== 0;
  const cash = trackCash ? getCashBalance(accountId) : 0;

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
  cash: number;
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

    accountValues.push({
      account_id: account.id,
      name: account.name,
      currency: account.currency,
      value: pv.value,
      value_eur: valueEur,
      value_usd: valueUsd,
      holdings_value: pv.holdings_value,
      cash: pv.cash,
    });

    totalEur += valueEur;
    totalUsd += valueUsd;
  }

  return { total_eur: totalEur, total_usd: totalUsd, accounts: accountValues };
}

// --- Total Deposited ---

export function getTotalDeposited(accountId?: string): number {
  if (accountId && accountId !== 'all') {
    const result = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'deposit'`
    ).get(accountId) as { total: number };
    return result.total;
  }
  const result = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'deposit'`
  ).get() as { total: number };
  return result.total;
}

// --- Daily PnL ---

export interface DailyPnL {
  today: { amount: number; pct: number };
  yesterday: { amount: number; pct: number };
}

export async function getDailyPnL(accountId?: string): Promise<DailyPnL> {
  // Get current holdings and their prices
  const holdings = await getHoldings(accountId);

  let todayChange = 0;
  let prevValue = 0;

  for (const h of holdings) {
    // Use regularMarketChange from the price service if we had it cached
    // For now, approximate: day change = current_price - previous_close
    // This is a simplified version — will improve with daily snapshots
    todayChange += h.day_gain;
    prevValue += h.market_value - h.day_gain;
  }

  const currentValue = holdings.reduce((s, h) => s + h.market_value, 0);
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
  total_pct: number;
}

export async function getAllTimePnL(accountId?: string): Promise<AllTimePnL> {
  const condition = accountId && accountId !== 'all' ? 'AND t.account_id = ?' : '';
  const params: string[] = accountId && accountId !== 'all' ? [accountId] : [];

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
    const txs = db.prepare(
      `SELECT date, type, quantity, price_per_unit
       FROM transactions
       WHERE ticker = ? AND account_id = ? AND type IN ('buy', 'sell')
       ORDER BY date`
    ).all(ticker, account_id) as Pick<Transaction, 'date' | 'type' | 'quantity' | 'price_per_unit'>[];

    const fifo = computeFIFO(txs);

    // Determine trading currency
    const tradeCcy = (db.prepare(
      `SELECT currency FROM transactions WHERE ticker = ? AND account_id = ? AND type = 'buy' LIMIT 1`
    ).get(ticker, account_id) as { currency: string } | undefined)?.currency || account_currency;

    // Convert realised gain from native currency to account currency
    const realisedInAcct = tradeCcy !== account_currency
      ? await convert(fifo.realised_gain, tradeCcy, account_currency)
      : fifo.realised_gain;
    totalRealised += realisedInAcct;

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
      totalUnrealised += unrealisedInAcct;

      // Cost basis in account currency for percentage calculation
      const costInAcct = tradeCcy !== account_currency
        ? await convert(fifo.cost_basis, tradeCcy, account_currency)
        : fifo.cost_basis;
      totalCostBasis += costInAcct;
    }
  }

  // Sum dividends (already in account currency from import)
  const divCondition = accountId && accountId !== 'all' ? 'WHERE account_id = ?' : '';
  const divParams: string[] = accountId && accountId !== 'all' ? [accountId] : [];
  const divResult = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${divCondition ? divCondition + ' AND' : 'WHERE'} type = 'dividend'`
  ).get(...divParams) as { total: number };
  const totalDividends = divResult.total;

  const total = totalUnrealised + totalRealised + totalDividends;
  // Total invested = current cost basis + what was spent on sold positions (approximated as cost basis + realised = proceeds)
  const totalInvested = totalCostBasis > 0 ? totalCostBasis : 1;
  const totalPct = (total / totalInvested) * 100;

  return {
    unrealised: totalUnrealised,
    realised: totalRealised,
    dividends: totalDividends,
    total,
    total_pct: totalPct,
  };
}
