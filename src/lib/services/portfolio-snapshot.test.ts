import { beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { PortfolioHolding } from '@/lib/types';

const testDb = new Database(':memory:');
testDb.exec(`
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, broker TEXT NOT NULL,
    currency TEXT NOT NULL, track_cash INTEGER DEFAULT 0
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL,
    date TEXT NOT NULL, type TEXT NOT NULL, ticker TEXT, quantity REAL,
    price_per_unit REAL, amount REAL, currency TEXT, commission REAL DEFAULT 0,
    notes TEXT
  );
  CREATE TABLE ticker_metadata (
    ticker TEXT PRIMARY KEY, name TEXT, sector TEXT, industry TEXT,
    asset_type TEXT, market TEXT, currency TEXT
  );
`);

const prices = new Map([
  ['AAA', { price: 15, currency: 'USD' }],
  ['NSENG:BBB', { price: 30, currency: 'NGN' }],
]);
const priceResult = (ticker: string) => ({
  ticker,
  price: prices.get(ticker)?.price ?? null,
  previousClose: null,
  change: null,
  changePct: null,
  currency: prices.get(ticker)?.currency ?? 'USD',
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  fiftyDayAverage: null,
  twoHundredDayAverage: null,
  stale: false,
});

let portfolio: typeof import('./portfolio');
let usdSnapshot: PortfolioHolding[];
let aggregateSnapshot: PortfolioHolding[];
let ngxSnapshot: PortfolioHolding[];

beforeAll(async () => {
  testDb.prepare('INSERT INTO accounts (id, name, broker, currency) VALUES (?, ?, ?, ?)')
    .run('usd', 'USD Account', 'Test', 'USD');
  testDb.prepare('INSERT INTO accounts (id, name, broker, currency) VALUES (?, ?, ?, ?)')
    .run('ngx', 'NGX Account', 'Test', 'NGN');
  const insert = testDb.prepare(`
    INSERT INTO transactions
      (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('usd', '2025-01-01', 'buy', 'AAA', 10, 10, 100, 'USD', 2);
  insert.run('usd', '2025-02-01', 'sell', 'AAA', 4, 12, 48, 'USD', 1);
  insert.run('usd', '2025-03-01', 'dividend', 'AAA', null, null, 5, 'USD', 0);
  insert.run('ngx', '2025-01-01', 'buy', 'NSENG:BBB', 3, 20, 60, 'NGN', 0);
  testDb.prepare('INSERT INTO ticker_metadata (ticker, name, market, currency) VALUES (?, ?, ?, ?)')
    .run('AAA', 'AAA Corp', 'us', 'USD');
  testDb.prepare('INSERT INTO ticker_metadata (ticker, name, market, currency) VALUES (?, ?, ?, ?)')
    .run('NSENG:BBB', 'BBB Plc', 'ngx', 'NGN');

  vi.resetModules();
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.doMock('@/lib/services/prices', () => ({
    getCurrentPrice: vi.fn(async (ticker: string) => priceResult(ticker)),
    getMultipleCurrentPrices: vi.fn(async (tickers: string[]) => tickers.map(priceResult)),
  }));
  vi.doMock('@/lib/services/fx', () => ({
    convert: vi.fn(async (amount: number) => amount),
  }));

  portfolio = await import('./portfolio');
  [usdSnapshot, aggregateSnapshot, ngxSnapshot] = await Promise.all([
    portfolio.getHoldings('usd'),
    portfolio.getHoldings(),
    portfolio.getHoldings('ngx'),
  ]);
});

describe('portfolio holdings snapshots', () => {
  it('keeps all-time P&L equivalent to the computed path', async () => {
    await expect(portfolio.getAllTimePnL('usd', usdSnapshot))
      .resolves.toEqual(await portfolio.getAllTimePnL('usd'));
  });

  it('falls back when an open position is absent from the supplied snapshot', async () => {
    await expect(portfolio.getAllTimePnL('usd', []))
      .resolves.toEqual(await portfolio.getAllTimePnL('usd'));
  });

  it('keeps aggregate values equivalent to the computed path', async () => {
    await expect(portfolio.getAggregateValue(aggregateSnapshot, ngxSnapshot))
      .resolves.toEqual(await portfolio.getAggregateValue());
  });
});
