import { describe, it, expect } from 'vitest';
import { calculateMWR } from '@/lib/services/returns';

describe('MWR/IRR - Newton-Raphson solver', () => {
  it('should return 0 for no cash flows', () => {
    expect(calculateMWR([], 0, new Date())).toBe(0);
  });

  it('should calculate return for single deposit + final value', () => {
    // Deposit $10,000, after 1 year it's worth $11,000 → ~10% return
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -10000 },
    ];
    const result = calculateMWR(cashFlows, 11000, new Date('2024-01-01'));
    // Should be approximately 10%
    expect(result).toBeCloseTo(0.10, 1);
  });

  it('should calculate return for single deposit with 0% return', () => {
    // Deposit $10,000, after 1 year still $10,000
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -10000 },
    ];
    const result = calculateMWR(cashFlows, 10000, new Date('2024-01-01'));
    expect(result).toBeCloseTo(0, 1);
  });

  it('should calculate negative return', () => {
    // Deposit $10,000, after 1 year it's worth $8,000 → -20% return
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -10000 },
    ];
    const result = calculateMWR(cashFlows, 8000, new Date('2024-01-01'));
    expect(result).toBeCloseTo(-0.20, 1);
  });

  it('should handle multiple deposits', () => {
    // Deposit $5,000, then 6 months later another $5,000
    // End value $11,000 after 1 year
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -5000 },
      { date: new Date('2023-07-01'), amount: -5000 },
    ];
    const result = calculateMWR(cashFlows, 11000, new Date('2024-01-01'));
    // Should be positive return, roughly 10%
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.3);
  });

  it('should handle deposits and withdrawals', () => {
    // Deposit $10,000, withdraw $2,000 after 6 months, end value $9,000
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -10000 },
      { date: new Date('2023-07-01'), amount: 2000 },
    ];
    const result = calculateMWR(cashFlows, 9000, new Date('2024-01-01'));
    // Started with 10k, withdrew 2k, now 9k → gained 1k on 10k → ~12.5%
    expect(result).toBeGreaterThan(0.05);
    expect(result).toBeLessThan(0.25);
  });

  it('should handle very short period', () => {
    // Deposit $10,000, after 1 month it's worth $10,100
    const cashFlows = [
      { date: new Date('2024-01-01'), amount: -10000 },
    ];
    const result = calculateMWR(cashFlows, 10100, new Date('2024-02-01'));
    // 1% monthly return, annualised via year-fraction IRR
    // The IRR solver works in annual terms, so result should be ~12.7%
    expect(result).toBeGreaterThan(0.10);
    expect(result).toBeLessThan(0.20);
  });

  it('should handle same-day deposit and value (zero time)', () => {
    const cashFlows = [
      { date: new Date('2024-01-01'), amount: -10000 },
    ];
    const result = calculateMWR(cashFlows, 10000, new Date('2024-01-01'));
    expect(result).toBe(0);
  });

  it('should handle large positive return', () => {
    // Deposit $1,000, after 1 year it's worth $3,000 → 200% return
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -1000 },
    ];
    const result = calculateMWR(cashFlows, 3000, new Date('2024-01-01'));
    expect(result).toBeCloseTo(2.0, 0); // ~200%
  });

  it('should not crash with total loss', () => {
    // Deposit $10,000, after 1 year it's worth $0
    const cashFlows = [
      { date: new Date('2023-01-01'), amount: -10000 },
    ];
    const result = calculateMWR(cashFlows, 0, new Date('2024-01-01'));
    expect(result).toBeLessThan(0);
    expect(isFinite(result)).toBe(true);
  });
});
