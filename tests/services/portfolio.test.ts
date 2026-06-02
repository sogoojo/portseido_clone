import { describe, it, expect, beforeEach } from 'vitest';
import { computeFIFO } from '@/lib/services/portfolio';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// --- FIFO Tests (pure function, no DB needed) ---

describe('FIFO - Simple buy/sell', () => {
  it('should compute holdings after a single buy', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
    ]);
    expect(result.quantity).toBe(10);
    expect(result.avg_cost).toBe(100);
    expect(result.cost_basis).toBe(1000);
  });

  it('should reduce holdings after a sell', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
      { date: '2024-02-01', type: 'sell', quantity: 3, price_per_unit: 120 },
    ]);
    expect(result.quantity).toBe(7);
    expect(result.avg_cost).toBe(100);
    expect(result.cost_basis).toBe(700);
  });

  it('should return zero after selling all', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
      { date: '2024-02-01', type: 'sell', quantity: 10, price_per_unit: 150 },
    ]);
    expect(result.quantity).toBeCloseTo(0, 4);
    expect(result.cost_basis).toBeCloseTo(0, 4);
  });
});

describe('FIFO - Multiple lots and partial sells', () => {
  it('should consume oldest lot first', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
      { date: '2024-02-01', type: 'buy', quantity: 10, price_per_unit: 200 },
      { date: '2024-03-01', type: 'sell', quantity: 10, price_per_unit: 150 },
    ]);
    // Should have sold the first lot (10 @ 100), left with 10 @ 200
    expect(result.quantity).toBe(10);
    expect(result.avg_cost).toBe(200);
    expect(result.cost_basis).toBe(2000);
  });

  it('should handle partial lot consumption', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
      { date: '2024-02-01', type: 'buy', quantity: 10, price_per_unit: 200 },
      { date: '2024-03-01', type: 'sell', quantity: 5, price_per_unit: 150 },
    ]);
    // Sold 5 from first lot: remaining = 5@100 + 10@200 = 15 shares
    expect(result.quantity).toBe(15);
    expect(result.cost_basis).toBe(500 + 2000); // 2500
    expect(result.avg_cost).toBeCloseTo(2500 / 15, 4); // ~166.67
  });

  it('should consume across multiple lots', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 5, price_per_unit: 100 },
      { date: '2024-02-01', type: 'buy', quantity: 5, price_per_unit: 150 },
      { date: '2024-03-01', type: 'buy', quantity: 5, price_per_unit: 200 },
      { date: '2024-04-01', type: 'sell', quantity: 8, price_per_unit: 180 },
    ]);
    // Sold: 5@100 (all of lot1) + 3@150 (partial lot2)
    // Remaining: 2@150 + 5@200 = 7 shares
    expect(result.quantity).toBe(7);
    expect(result.cost_basis).toBe(2 * 150 + 5 * 200); // 300 + 1000 = 1300
    expect(result.avg_cost).toBeCloseTo(1300 / 7, 4);
  });

  it('should handle multiple buys and sells interleaved', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
      { date: '2024-02-01', type: 'sell', quantity: 3, price_per_unit: 110 },
      { date: '2024-03-01', type: 'buy', quantity: 5, price_per_unit: 120 },
      { date: '2024-04-01', type: 'sell', quantity: 4, price_per_unit: 130 },
    ]);
    // After first sell: 7@100
    // After second buy: 7@100 + 5@120
    // After second sell: consume 4 from first lot → 3@100 + 5@120 = 8 shares
    expect(result.quantity).toBe(8);
    expect(result.cost_basis).toBe(3 * 100 + 5 * 120); // 300 + 600 = 900
    expect(result.avg_cost).toBeCloseTo(900 / 8, 4); // 112.5
  });
});

describe('FIFO - Edge cases', () => {
  it('should handle sell exceeding holdings without crashing', () => {
    // This should log a warning but not throw
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 5, price_per_unit: 100 },
      { date: '2024-02-01', type: 'sell', quantity: 10, price_per_unit: 120 },
    ]);
    expect(result.quantity).toBeCloseTo(0, 4);
    expect(result.cost_basis).toBeCloseTo(0, 4);
  });

  it('should handle no transactions', () => {
    const result = computeFIFO([]);
    expect(result.quantity).toBe(0);
    expect(result.avg_cost).toBe(0);
    expect(result.cost_basis).toBe(0);
  });

  it('should handle only sells (no buys)', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'sell', quantity: 5, price_per_unit: 100 },
    ]);
    expect(result.quantity).toBeCloseTo(0, 4);
  });

  it('should process transactions in date order regardless of input order', () => {
    const result = computeFIFO([
      { date: '2024-03-01', type: 'sell', quantity: 5, price_per_unit: 120 },
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
    ]);
    // Should sort by date: buy first, then sell
    expect(result.quantity).toBe(5);
    expect(result.avg_cost).toBe(100);
  });

  it('should handle fractional shares', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 0.5, price_per_unit: 62000 },
      { date: '2024-02-01', type: 'sell', quantity: 0.1, price_per_unit: 65000 },
    ]);
    expect(result.quantity).toBeCloseTo(0.4, 6);
    expect(result.cost_basis).toBeCloseTo(0.4 * 62000, 2);
  });
});

// --- Cash Balance Tests (require in-memory SQLite) ---

describe('Cash Balance', () => {
  let testDb: InstanceType<typeof Database>;

  beforeEach(() => {
    testDb = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    testDb.exec(schema);

    // Seed a test account
    testDb.prepare('INSERT INTO accounts (id, name, broker, currency) VALUES (?, ?, ?, ?)').run('test', 'Test', 'test', 'USD');
  });

  function getCashBalanceFromDb(accountId: string): number {
    const deposits = testDb.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'deposit'`
    ).get(accountId) as { total: number };
    const withdrawals = testDb.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'withdrawal'`
    ).get(accountId) as { total: number };
    const buyCosts = testDb.prepare(
      `SELECT COALESCE(SUM(quantity * price_per_unit + commission), 0) as total FROM transactions WHERE account_id = ? AND type = 'buy'`
    ).get(accountId) as { total: number };
    const sellProceeds = testDb.prepare(
      `SELECT COALESCE(SUM(quantity * price_per_unit - commission), 0) as total FROM transactions WHERE account_id = ? AND type = 'sell'`
    ).get(accountId) as { total: number };
    const dividends = testDb.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'dividend'`
    ).get(accountId) as { total: number };

    return deposits.total - withdrawals.total - buyCosts.total + sellProceeds.total + dividends.total;
  }

  it('should start with zero cash', () => {
    expect(getCashBalanceFromDb('test')).toBe(0);
  });

  it('should add deposits', () => {
    testDb.prepare(
      `INSERT INTO transactions (account_id, date, type, amount, currency) VALUES (?, ?, ?, ?, ?)`
    ).run('test', '2024-01-01', 'deposit', 10000, 'USD');

    expect(getCashBalanceFromDb('test')).toBe(10000);
  });

  it('should subtract withdrawals', () => {
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, amount, currency) VALUES (?, ?, ?, ?, ?)`).run('test', '2024-01-01', 'deposit', 10000, 'USD');
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, amount, currency) VALUES (?, ?, ?, ?, ?)`).run('test', '2024-02-01', 'withdrawal', 3000, 'USD');

    expect(getCashBalanceFromDb('test')).toBe(7000);
  });

  it('should subtract buy costs including commission', () => {
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, amount, currency) VALUES (?, ?, ?, ?, ?)`).run('test', '2024-01-01', 'deposit', 10000, 'USD');
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('test', '2024-02-01', 'buy', 'AAPL', 10, 150, 1500, 'USD', 5);

    // 10000 - (10*150 + 5) = 10000 - 1505 = 8495
    expect(getCashBalanceFromDb('test')).toBe(8495);
  });

  it('should add sell proceeds minus commission', () => {
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, amount, currency) VALUES (?, ?, ?, ?, ?)`).run('test', '2024-01-01', 'deposit', 10000, 'USD');
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('test', '2024-02-01', 'buy', 'AAPL', 10, 150, 1500, 'USD', 5);
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('test', '2024-03-01', 'sell', 'AAPL', 5, 180, 900, 'USD', 5);

    // 10000 - (10*150+5) + (5*180-5) = 10000 - 1505 + 895 = 9390
    expect(getCashBalanceFromDb('test')).toBe(9390);
  });

  it('should add dividends', () => {
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, amount, currency) VALUES (?, ?, ?, ?, ?)`).run('test', '2024-01-01', 'deposit', 5000, 'USD');
    testDb.prepare(`INSERT INTO transactions (account_id, date, type, ticker, amount, currency) VALUES (?, ?, ?, ?, ?, ?)`).run('test', '2024-06-01', 'dividend', 'AAPL', 50, 'USD');

    expect(getCashBalanceFromDb('test')).toBe(5050);
  });
});
