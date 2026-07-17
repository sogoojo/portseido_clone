import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const getHistoricalPrices = vi.fn();
let getBenchmarkReturns: typeof import('./returns').getBenchmarkReturns;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
  vi.resetModules();
  vi.doMock('@/lib/db', () => ({
    default: {
      prepare: () => ({ get: () => ({ d: '2020-01-01' }) }),
    },
  }));
  vi.doMock('@/lib/services/prices', () => ({ getHistoricalPrices }));
  vi.doMock('@/lib/services/fx', () => ({ convert: vi.fn() }));
  vi.doMock('@/lib/services/portfolio', () => ({ getPortfolioValue: vi.fn(), getAggregateValue: vi.fn() }));
  vi.doMock('@/lib/services/history', () => ({ buildValuationContext: vi.fn() }));

  getHistoricalPrices.mockResolvedValue([
    { date: '2020-01-01', close: 100 },
    { date: '2021-07-17', close: 120 },
    { date: '2024-07-17', close: 150 },
    { date: '2025-07-17', close: 160 },
    { date: '2026-01-01', close: 170 },
    { date: '2026-04-17', close: 180 },
    { date: '2026-06-17', close: 190 },
    { date: '2026-07-17', close: 200 },
  ]);

  ({ getBenchmarkReturns } = await import('./returns'));
});

afterAll(() => vi.useRealTimers());

describe('getBenchmarkReturns', () => {
  it('loads one complete series and derives every period from it', async () => {
    const result = await getBenchmarkReturns('^GSPC');

    expect(getHistoricalPrices).toHaveBeenCalledTimes(1);
    expect(getHistoricalPrices.mock.calls[0][0]).toBe('^GSPC');
    expect(result).toHaveLength(8);
    expect(Object.fromEntries(result.map(row => [row.period, row.return_pct]))).toMatchObject({
      '1M': ((200 - 190) / 190) * 100,
      '3M': ((200 - 180) / 180) * 100,
      YTD: ((200 - 170) / 170) * 100,
      '1Y': 25,
      '2Y': ((200 - 150) / 150) * 100,
      '5Y': ((200 - 120) / 120) * 100,
      All: 100,
    });
  });
});
