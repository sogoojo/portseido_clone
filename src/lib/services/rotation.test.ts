import { describe, it, expect } from 'vitest';
import { retDaysAgo, sma, stageOf } from './rotation';

// A rising series: close[i] = 100 + i
const rising = Array.from({ length: 260 }, (_, i) => 100 + i);

describe('retDaysAgo', () => {
  it('computes total return over n trading days', () => {
    // last = 359, 21 days ago = 338 -> 359/338 - 1
    expect(retDaysAgo(rising, 21)).toBeCloseTo(359 / 338 - 1, 6);
  });
  it('returns null when there is too little data', () => {
    expect(retDaysAgo([100, 101, 102], 21)).toBeNull();
  });
});

describe('sma', () => {
  it('averages the last n closes', () => {
    expect(sma([10, 20, 30, 40], 2)).toBe(35);
  });
  it('returns null when fewer than n closes', () => {
    expect(sma([10, 20], 5)).toBeNull();
  });
});

describe('stageOf', () => {
  it('flags a market laggard as weak', () => {
    expect(stageOf(-0.01, 0.2)).toBe('weak');
  });
  it('flags a fresh leader as early', () => {
    expect(stageOf(0.05, 0.02)).toBe('early');
  });
  it('flags a stretched leader as late', () => {
    expect(stageOf(0.05, 0.2)).toBe('late');
  });
});
