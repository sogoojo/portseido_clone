import db from '@/lib/db';
import { getHistoricalPrices } from '@/lib/services/prices';
import type { Transaction } from '@/lib/types';

// Historical portfolio valuation, shared by the history chart, period MWR and
// historical returns. All output values are USD: holdings are valued at the
// historical close of each date and converted at that date's FX rate.

type TxRow = Transaction & { account_currency: string; track_cash: number };

// --- Date-indexed series with closest-on-or-before lookup ---

class DateSeries {
  private dates: string[] = [];
  private values: number[] = [];

  constructor(rows: { date: string; close: number }[]) {
    // rows come from price_cache ordered by date
    for (const r of rows) {
      this.dates.push(r.date);
      this.values.push(r.close);
    }
  }

  get size(): number {
    return this.dates.length;
  }

  /** Latest value on or before `date`; falls back to the earliest known value. */
  at(date: string): number | null {
    if (this.dates.length === 0) return null;
    // binary search for rightmost date <= target
    let lo = 0;
    let hi = this.dates.length - 1;
    if (this.dates[0] > date) return this.values[0]; // before first data point
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.dates[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    return this.values[lo];
  }
}

// --- Valuation context ---

export interface ValuationPoint {
  holdings_value: number; // USD
  cash: number; // USD, only accounts with track_cash
  total: number; // USD
  deposits_cumulative: number; // USD, gross external inflows at flow-date FX
  net_deposits: number; // USD, inflows - outflows at flow-date FX
}

/**
 * An external cash flow in MWR sign convention: negative = money into the
 * portfolio, positive = money out. For accounts that track cash these are
 * deposits/withdrawals; for accounts that don't record deposits (track_cash=0)
 * the buys, sells and dividends are the points where money enters/leaves the
 * modelled portfolio.
 */
export interface ExternalFlow {
  date: string;
  amountUsd: number;
}

export interface ValuationContext {
  transactions: TxRow[];
  firstDate: string | null;
  flows: ExternalFlow[];
  valueAt(date: string): ValuationPoint;
  fxToUsd(currency: string, date: string): number;
}

function isoDaysAgo(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

export async function buildValuationContext(accountId: string | undefined, to: Date): Promise<ValuationContext> {
  const condition = accountId && accountId !== 'all' ? 'AND t.account_id = ?' : '';
  const params: string[] = accountId && accountId !== 'all' ? [accountId] : [];
  const toStr = to.toISOString().split('T')[0];

  const transactions = db.prepare(
    `SELECT t.*, a.currency as account_currency, a.track_cash
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.date <= ? ${condition}
     ORDER BY t.date, t.id`
  ).all(toStr, ...params) as TxRow[];

  const firstDate = transactions.length > 0 ? transactions[0].date : null;
  // Fetch series from the first transaction so any date in the portfolio's
  // lifetime can be valued (results are cached permanently in SQLite).
  const seriesFrom = firstDate ? isoDaysAgo(new Date(firstDate), 14) : isoDaysAgo(to, 14);

  // Price series per ticker
  const tickers = new Set<string>();
  for (const tx of transactions) {
    if (tx.ticker && (tx.type === 'buy' || tx.type === 'sell')) tickers.add(tx.ticker);
  }

  const priceSeries = new Map<string, { series: DateSeries; currency: string }>();
  for (const ticker of tickers) {
    const rows = await getHistoricalPrices(ticker, seriesFrom, to);
    const meta = db.prepare('SELECT currency FROM ticker_metadata WHERE ticker = ?').get(ticker) as { currency: string | null } | undefined;
    const currency = rows[0]?.currency || meta?.currency || 'USD';
    priceSeries.set(ticker, { series: new DateSeries(rows), currency });
  }

  // FX series per currency (vs USD). 'GBp' (pence) shares the GBP series.
  const currencies = new Set<string>();
  for (const { currency } of priceSeries.values()) currencies.add(currency);
  for (const tx of transactions) {
    currencies.add(tx.currency || tx.account_currency);
    currencies.add(tx.account_currency);
  }

  const fxSeries = new Map<string, DateSeries>();
  for (const raw of currencies) {
    const ccy = raw === 'GBp' || raw.toUpperCase() === 'GBX' ? 'GBP' : raw.toUpperCase();
    if (ccy === 'USD' || fxSeries.has(ccy)) continue;
    const rows = await getHistoricalPrices(`${ccy}USD=X`, seriesFrom, to);
    fxSeries.set(ccy, new DateSeries(rows));
  }

  function fxToUsd(currency: string, date: string): number {
    if (!currency || currency.toUpperCase() === 'USD') return 1;
    const pence = currency === 'GBp' || currency.toUpperCase() === 'GBX';
    const ccy = pence ? 'GBP' : currency.toUpperCase();
    const rate = fxSeries.get(ccy)?.at(date);
    if (rate == null) {
      console.error(`[History] No ${ccy}USD rate for ${date} — using 1:1`);
      return pence ? 0.01 : 1;
    }
    return pence ? rate / 100 : rate;
  }

  // --- External flows (precomputed; price-independent) ---
  const flows: ExternalFlow[] = [];
  for (const tx of transactions) {
    const txCcy = tx.currency || tx.account_currency;
    const usd = (amount: number) => amount * fxToUsd(txCcy, tx.date);
    const trackCash = tx.track_cash !== 0;

    if (trackCash) {
      // Cash is modelled: deposits/withdrawals are the external flows,
      // buys/sells/dividends just move value between cash and holdings
      if (tx.type === 'deposit') flows.push({ date: tx.date, amountUsd: -usd(tx.amount || 0) });
      else if (tx.type === 'withdrawal') flows.push({ date: tx.date, amountUsd: usd(tx.amount || 0) });
    } else {
      // Cash is NOT modelled: money enters at buys and leaves at sells and
      // dividends. Recorded deposits/withdrawals are ignored here to avoid
      // double-counting the same capital as its subsequent buy.
      if (tx.type === 'buy' && tx.quantity) {
        flows.push({ date: tx.date, amountUsd: -usd(tx.quantity * (tx.price_per_unit || 0) + (tx.commission || 0)) });
      } else if (tx.type === 'sell' && tx.quantity) {
        flows.push({ date: tx.date, amountUsd: usd(tx.quantity * (tx.price_per_unit || 0) - (tx.commission || 0)) });
      } else if (tx.type === 'dividend') {
        flows.push({ date: tx.date, amountUsd: usd(tx.amount || 0) });
      }
    }
  }

  // --- Incremental replay state ---
  let cursor = 0;
  let lastDate = '';
  let lots = new Map<string, { qty: number }[]>();
  let cashByAccount = new Map<string, { balance: number; currency: string; trackCash: boolean }>();
  let depositsCumUsd = 0;
  let netDepositsUsd = 0;

  function reset() {
    cursor = 0;
    lastDate = '';
    lots = new Map();
    cashByAccount = new Map();
    depositsCumUsd = 0;
    netDepositsUsd = 0;
  }

  function advanceTo(date: string) {
    while (cursor < transactions.length && transactions[cursor].date <= date) {
      const tx = transactions[cursor];
      cursor++;

      let acct = cashByAccount.get(tx.account_id);
      if (!acct) {
        acct = { balance: 0, currency: tx.account_currency, trackCash: tx.track_cash !== 0 };
        cashByAccount.set(tx.account_id, acct);
      }
      const txCcy = tx.currency || tx.account_currency;
      // converts an amount in the transaction's currency into the account's currency at tx date
      const toAcct = (amount: number) =>
        txCcy === acct!.currency ? amount : amount * (fxToUsd(txCcy, tx.date) / fxToUsd(acct!.currency, tx.date));

      if (tx.type === 'buy' && tx.ticker && tx.quantity) {
        if (!lots.has(tx.ticker)) lots.set(tx.ticker, []);
        lots.get(tx.ticker)!.push({ qty: tx.quantity });
        const cost = tx.quantity * (tx.price_per_unit || 0) + (tx.commission || 0);
        acct.balance -= toAcct(cost);
        if (!acct.trackCash) {
          const usd = cost * fxToUsd(txCcy, tx.date);
          depositsCumUsd += usd;
          netDepositsUsd += usd;
        }
      } else if (tx.type === 'sell' && tx.ticker && tx.quantity) {
        const tickerLots = lots.get(tx.ticker) || [];
        let toSell = tx.quantity;
        for (const lot of tickerLots) {
          if (toSell <= 0) break;
          const consume = Math.min(lot.qty, toSell);
          lot.qty -= consume;
          toSell -= consume;
        }
        const proceeds = tx.quantity * (tx.price_per_unit || 0) - (tx.commission || 0);
        acct.balance += toAcct(proceeds);
        if (!acct.trackCash) {
          netDepositsUsd -= proceeds * fxToUsd(txCcy, tx.date);
        }
      } else if (tx.type === 'deposit') {
        acct.balance += toAcct(tx.amount || 0);
        if (acct.trackCash) {
          const usd = (tx.amount || 0) * fxToUsd(txCcy, tx.date);
          depositsCumUsd += usd;
          netDepositsUsd += usd;
        }
      } else if (tx.type === 'withdrawal') {
        acct.balance -= toAcct(tx.amount || 0);
        if (acct.trackCash) {
          netDepositsUsd -= (tx.amount || 0) * fxToUsd(txCcy, tx.date);
        }
      } else if (tx.type === 'dividend') {
        acct.balance += toAcct(tx.amount || 0);
        if (!acct.trackCash) {
          netDepositsUsd -= (tx.amount || 0) * fxToUsd(txCcy, tx.date);
        }
      }
    }
  }

  function valueAt(date: string): ValuationPoint {
    if (date < lastDate) reset(); // out-of-order call: replay from scratch
    lastDate = date;
    advanceTo(date);

    let holdingsValue = 0;
    for (const [ticker, tickerLots] of lots) {
      const qty = tickerLots.reduce((s, l) => s + l.qty, 0);
      if (qty <= 0.0001) continue;
      const ps = priceSeries.get(ticker);
      const price = ps?.series.at(date);
      if (ps == null || price == null) continue; // no price data — excluded from value
      holdingsValue += qty * price * fxToUsd(ps.currency, date);
    }

    let cash = 0;
    for (const acct of cashByAccount.values()) {
      if (!acct.trackCash) continue;
      cash += acct.balance * fxToUsd(acct.currency, date);
    }

    return {
      holdings_value: holdingsValue,
      cash,
      total: holdingsValue + cash,
      deposits_cumulative: depositsCumUsd,
      net_deposits: netDepositsUsd,
    };
  }

  return { transactions, firstDate, flows, valueAt, fxToUsd };
}
