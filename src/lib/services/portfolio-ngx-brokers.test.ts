import { beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { NgxBrokerBreakdown } from './portfolio';

const testDb = new Database(':memory:');
testDb.exec(`
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    ticker TEXT,
    quantity REAL,
    price_per_unit REAL,
    amount REAL,
    currency TEXT NOT NULL,
    commission REAL DEFAULT 0,
    notes TEXT
  );
  CREATE TABLE ticker_metadata (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    sector TEXT,
    industry TEXT,
    asset_type TEXT,
    market TEXT,
    currency TEXT
  );
`);

const priceByTicker: Record<string, number> = {
  'NSENG:AAA': 20,
  'NSENG:DDD': 25,
  'NSENG:BETAGLAS': 30,
  'NSENG:BBB': 40,
  'NSENG:OTHER': 50,
};
const getMultipleCurrentPrices = vi.fn(async (tickers: string[]) => tickers.map(ticker => ({
  ticker,
  price: priceByTicker[ticker] ?? null,
  previousClose: null,
  change: null,
  changePct: null,
  currency: 'NGN',
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  fiftyDayAverage: null,
  twoHundredDayAverage: null,
  stale: false,
})));

let result: NgxBrokerBreakdown[];

beforeAll(async () => {
  const insert = testDb.prepare(`
    INSERT INTO transactions
      (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission, notes)
    VALUES ('ngx', ?, ?, ?, ?, ?, ?, 'NGN', ?, ?)
  `);
  const add = (date: string, type: string, ticker: string, qty: number, price: number, notes: string | null, commission = 0) =>
    insert.run(date, type, ticker, qty, price, qty * price, commission, notes);

  // Trove old/Innova merge; AAA remains partially open.
  add('2025-01-01', 'buy', 'NSENG:AAA', 10, 10, 'Trove (old) order-1');
  add('2025-01-02', 'sell', 'NSENG:AAA', 4, 15, 'Trove (old) order-2');
  add('2025-01-03', 'buy', 'NSENG:DDD', 4, 20, 'Trove (Innova) order-3');

  // BETAGLAS is closed at Trove, then independently open at Bamboo.
  add('2025-01-04', 'buy', 'NSENG:BETAGLAS', 5, 12, 'Trove (old) order-4');
  add('2025-01-05', 'sell', 'NSENG:BETAGLAS', 5, 14, 'Trove (old) order-5');
  add('2025-02-01', 'buy', 'NSENG:BETAGLAS', 7, 18, 'Bamboo BETAGLAS buy');
  add('2025-02-02', 'buy', 'NSENG:BBB', 3, 30, 'Bamboo BBB buy');

  // Fully closed Bamboo position must not appear.
  add('2025-02-03', 'buy', 'NSENG:STANBIC', 2, 10, 'Bamboo STANBIC buy');
  add('2025-02-04', 'sell', 'NSENG:STANBIC', 2, 11, 'Bamboo STANBIC sell');

  // Missing provenance is retained in the safety bucket.
  add('2025-03-01', 'buy', 'NSENG:OTHER', 2, 45, null);
  add('2025-03-02', 'buy', 'NSENG:NOPRICE', 1, 12, 'manual entry');

  for (const ticker of Object.keys(priceByTicker)) {
    testDb.prepare(`INSERT INTO ticker_metadata (ticker, name, sector, asset_type, market, currency)
                    VALUES (?, ?, 'Test sector', 'ngx_equity', 'ngx', 'NGN')`).run(ticker, ticker.replace('NSENG:', ''));
  }

  vi.resetModules();
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.doMock('@/lib/services/prices', () => ({
    getMultipleCurrentPrices,
    getCurrentPrice: vi.fn(),
  }));
  vi.doMock('@/lib/services/fx', () => ({ convert: vi.fn(async (amount: number) => amount) }));

  const portfolio = await import('./portfolio');
  result = await portfolio.getNgxBrokerHoldings();
});

describe('getNgxBrokerHoldings', () => {
  it('merges Trove note variants and buckets Bamboo and untagged trades separately', () => {
    expect(result.map(bucket => bucket.broker)).toEqual(['Trove', 'Bamboo', 'Other']);
    expect(result.find(bucket => bucket.broker === 'Trove')?.holdings.map(h => h.ticker)).toEqual([
      'NSENG:AAA', 'NSENG:DDD',
    ]);
    expect(result.find(bucket => bucket.broker === 'Other')?.holdings[0].ticker).toBe('NSENG:OTHER');
  });

  it('runs FIFO within each broker and omits sold-out groups', () => {
    const troveAaa = result.find(bucket => bucket.broker === 'Trove')?.holdings.find(h => h.ticker === 'NSENG:AAA');
    expect(troveAaa).toMatchObject({ quantity: 6, cost_basis: 60, current_price: 20, market_value: 120 });
    expect(result.flatMap(bucket => bucket.holdings).some(h => h.ticker === 'NSENG:STANBIC')).toBe(false);
  });

  it('keeps the same ticker independent across brokers', () => {
    expect(result.find(bucket => bucket.broker === 'Trove')?.holdings.some(h => h.ticker === 'NSENG:BETAGLAS')).toBe(false);
    expect(result.find(bucket => bucket.broker === 'Bamboo')?.holdings.find(h => h.ticker === 'NSENG:BETAGLAS')).toMatchObject({
      quantity: 7,
      cost_basis: 126,
      market_value: 210,
    });
  });

  it('orders known buckets and omits empty buckets', () => {
    expect(result.map(bucket => bucket.broker)).toEqual(['Trove', 'Bamboo', 'Other']);
    expect(result.every(bucket => bucket.holdings.length > 0)).toBe(true);
  });

  it('allocates within each broker and batches every unique ticker once', () => {
    for (const bucket of result) {
      expect(bucket.holdings.reduce((sum, holding) => sum + holding.allocation_pct, 0)).toBeCloseTo(100);
      expect(bucket.total_value).toBe(bucket.holdings.reduce((sum, holding) => sum + holding.market_value, 0));
    }
    expect(getMultipleCurrentPrices).toHaveBeenCalledTimes(1);
    expect(new Set(getMultipleCurrentPrices.mock.calls[0][0])).toEqual(new Set([
      ...Object.keys(priceByTicker), 'NSENG:NOPRICE',
    ]));
  });

  it('keeps an open holding when its current price is unavailable', () => {
    expect(result.find(bucket => bucket.broker === 'Other')?.holdings.find(h => h.ticker === 'NSENG:NOPRICE')).toMatchObject({
      current_price: 0,
      market_value: 0,
    });
  });
});
