import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runIntegrityAudit } from '@/lib/integrity-audit';

function fixtureDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, date TEXT NOT NULL,
      type TEXT NOT NULL, ticker TEXT, quantity REAL, price_per_unit REAL,
      amount REAL, currency TEXT NOT NULL, commission REAL DEFAULT 0, notes TEXT
    );
    CREATE TABLE price_cache (
      ticker TEXT NOT NULL, date TEXT NOT NULL, close REAL NOT NULL,
      currency TEXT NOT NULL, PRIMARY KEY (ticker, date)
    );
    CREATE TABLE fx_cache (
      pair TEXT NOT NULL, date TEXT NOT NULL, rate REAL NOT NULL,
      PRIMARY KEY (pair, date)
    );
  `);
  return db;
}

describe('runIntegrityAudit', () => {
  it('reports repeat economics as candidates with the full intraday sequence', () => {
    const db = fixtureDb();
    db.exec(`
      INSERT INTO transactions VALUES
        (1, 'tr', '2025-09-18', 'sell', 'AMD', 5, 134.04, 670.20, 'EUR', 0, NULL),
        (2, 'tr', '2025-09-18', 'buy',  'AMD', 5, 134.04, 670.20, 'EUR', 0, 'order-2'),
        (3, 'tr', '2025-09-18', 'buy',  'AMD', 5, 134.04, 670.20, 'EUR', 0, NULL),
        (4, 'tr', '2025-09-18', 'sell', 'AMD', 5, 134.00, 670.00, 'EUR', 0, NULL),
        (5, 'tr', '2025-09-18', 'buy',  'AMD', 5, 134.04, 670.20, 'EUR', 0, NULL);
    `);
    const report = runIntegrityAudit(db);
    expect(report.exact_economic_candidates).toHaveLength(1);
    expect(report.exact_economic_candidates[0].ids).toEqual([2, 3, 5]);
    expect(report.exact_economic_candidates[0].same_day_sequence.map(t => t.id)).toEqual([1, 2, 3, 4, 5]);
    expect(report.exact_economic_candidates[0].same_day_sequence[1].notes).toBe('order-2');
    expect(report.oversell_candidates[0]).toMatchObject({ id: 1, quantity_available: 0, shortfall: 5 });
  });

  it('does not group identical economics recorded in different currencies', () => {
    const db = fixtureDb();
    db.exec(`
      INSERT INTO transactions VALUES
        (6, 'tr', '2025-09-18', 'buy', 'AMD', 5, 134.04, 670.20, 'EUR', 0, NULL),
        (7, 'tr', '2025-09-18', 'buy', 'AMD', 5, 134.04, 670.20, 'USD', 0, NULL);
    `);
    expect(runIntegrityAudit(db).exact_economic_candidates).toHaveLength(0);
  });

  it('reports amount mismatches and mixed-currency price evidence without deciding a relabel', () => {
    const db = fixtureDb();
    db.exec(`
      INSERT INTO transactions VALUES
        (10, 'degiro', '2025-01-02', 'buy', 'MSFT', 2, 402, 999, 'EUR', 0, 'broker-ref-10'),
        (11, 'degiro', '2025-02-03', 'buy', 'MSFT', 1, 415, 415, 'USD', 0, NULL);
      INSERT INTO price_cache VALUES
        ('MSFT', '2025-01-02', 418, 'USD'),
        ('MSFT', '2025-02-03', 412, 'USD');
      INSERT INTO fx_cache VALUES ('USDEUR', '2025-01-02', 0.96);
    `);
    const report = runIntegrityAudit(db);
    expect(report.amount_mismatches[0]).toMatchObject({ id: 10, computed_amount: 804, difference: 195 });
    expect(report.mixed_currency_positions).toHaveLength(1);
    expect(report.mixed_currency_positions[0]).toMatchObject({ first_buy_currency: 'EUR', currencies: ['EUR', 'USD'] });
    expect(report.mixed_currency_positions[0].price_evidence.map(e => e.magnitude_match)).toEqual([
      'recorded_matches_fx_converted_close', 'recorded_matches_close',
    ]);
  });

  it('reports ambiguity when raw and converted-close hypotheses are similarly plausible', () => {
    const db = fixtureDb();
    db.exec(`
      INSERT INTO transactions VALUES
        (12, 'degiro', '2025-01-02', 'buy', 'MSFT', 1, 407, 407, 'EUR', 0, NULL),
        (13, 'degiro', '2025-02-03', 'buy', 'MSFT', 1, 415, 415, 'USD', 0, NULL);
      INSERT INTO price_cache VALUES
        ('MSFT', '2025-01-02', 418, 'USD'),
        ('MSFT', '2025-02-03', 412, 'USD');
      INSERT INTO fx_cache VALUES ('USDEUR', '2025-01-02', 0.95);
    `);
    const report = runIntegrityAudit(db);
    expect(report.mixed_currency_positions[0].price_evidence[0].magnitude_match).toBe('ambiguous');
  });

  it('detects a chronological oversell per account and ticker', () => {
    const db = fixtureDb();
    db.exec(`
      INSERT INTO transactions VALUES
        (20, 'a', '2025-01-01', 'buy', 'XYZ', 3, 10, 30, 'USD', 0, NULL),
        (21, 'a', '2025-01-02', 'sell', 'XYZ', 5, 11, 55, 'USD', 0, NULL),
        (22, 'b', '2025-01-01', 'buy', 'XYZ', 10, 10, 100, 'USD', 0, NULL);
    `);
    const report = runIntegrityAudit(db);
    expect(report.oversell_candidates).toEqual([expect.objectContaining({ id: 21, shortfall: 2 })]);
  });

  it('does not carry an oversell shortfall into later rows and rejects impossible dates', () => {
    const db = fixtureDb();
    db.exec(`
      INSERT INTO transactions VALUES
        (30, 'a', '2025-02-30', 'deposit', NULL, NULL, NULL, 100, 'USD', 0, NULL),
        (31, 'a', '2025-03-01', 'sell', 'XYZ', 5, 10, 50, 'USD', 0, NULL),
        (32, 'a', '2025-03-02', 'sell', 'XYZ', 2, 10, 20, 'USD', 0, NULL);
    `);
    const report = runIntegrityAudit(db);
    expect(report.invalid_transactions).toEqual([expect.objectContaining({ id: 30, reasons: ['invalid date'] })]);
    expect(report.oversell_candidates.map(row => row.shortfall)).toEqual([5, 2]);
  });
});
