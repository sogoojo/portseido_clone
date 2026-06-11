import { describe, it, expect } from 'vitest';
import { computeFIFO } from '@/lib/services/portfolio';

describe('computeFIFO with commissions', () => {
  it('includes buy commission in cost basis', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100, commission: 5 },
    ]);
    expect(result.cost_basis).toBeCloseTo(1005);
    expect(result.avg_cost).toBeCloseTo(100.5);
  });

  it('subtracts sell commission from realised gain', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100, commission: 0 },
      { date: '2024-06-01', type: 'sell', quantity: 10, price_per_unit: 120, commission: 5 },
    ]);
    // gross gain 200, minus 5 sell commission
    expect(result.realised_gain).toBeCloseTo(195);
    expect(result.quantity).toBe(0);
  });

  it('accounts for both commissions across a round trip', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100, commission: 2 },
      { date: '2024-06-01', type: 'sell', quantity: 10, price_per_unit: 120, commission: 3 },
    ]);
    // buy cost 1002 → unit cost 100.2; proceeds 1200 − 3 = gain 1200 − 1002 − 3 = 195
    expect(result.realised_gain).toBeCloseTo(195);
  });

  it('behaves as before when commission is absent', () => {
    const result = computeFIFO([
      { date: '2024-01-01', type: 'buy', quantity: 10, price_per_unit: 100 },
      { date: '2024-06-01', type: 'sell', quantity: 5, price_per_unit: 110 },
    ]);
    expect(result.realised_gain).toBeCloseTo(50);
    expect(result.quantity).toBe(5);
    expect(result.avg_cost).toBeCloseTo(100);
  });
});
