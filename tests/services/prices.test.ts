import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the routing logic and cache behavior without hitting real APIs.
// The actual PriceService depends on db and yahoo-finance2, so we test the logic patterns.

describe('Price Service - Ticker Routing', () => {
  it('should identify NGX tickers by NSENG: prefix', () => {
    const isNgx = (ticker: string) => ticker.startsWith('NSENG:');

    expect(isNgx('NSENG:MTNN')).toBe(true);
    expect(isNgx('NSENG:ZENITHBANK')).toBe(true);
    expect(isNgx('AAPL')).toBe(false);
    expect(isNgx('BTC-USD')).toBe(false);
    expect(isNgx('^GSPC')).toBe(false);
    expect(isNgx('EURUSD=X')).toBe(false);
  });

  it('should strip NSENG: prefix for NGX symbols', () => {
    const ngxSymbol = (ticker: string) => ticker.replace(/^NSENG:/, '');

    expect(ngxSymbol('NSENG:MTNN')).toBe('MTNN');
    expect(ngxSymbol('NSENG:ZENITHBANK')).toBe('ZENITHBANK');
    expect(ngxSymbol('AAPL')).toBe('AAPL'); // no-op for non-NGX
  });

  it('should route Yahoo tickers unchanged', () => {
    const yahooSymbol = (ticker: string) => ticker;

    expect(yahooSymbol('AAPL')).toBe('AAPL');
    expect(yahooSymbol('BTC-USD')).toBe('BTC-USD');
    expect(yahooSymbol('^GSPC')).toBe('^GSPC');
    expect(yahooSymbol('EURUSD=X')).toBe('EURUSD=X');
  });
});

describe('Price Service - Cache Staleness', () => {
  it('should consider cache stale after 15 minutes', () => {
    const CACHE_STALENESS_MS = 15 * 60 * 1000;
    const isCacheStale = (fetchedAt: string) => {
      const fetchedTime = new Date(fetchedAt + 'Z').getTime();
      return Date.now() - fetchedTime > CACHE_STALENESS_MS;
    };

    // Fresh (1 minute ago)
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString().replace('Z', '').split('.')[0];
    expect(isCacheStale(oneMinAgo)).toBe(false);

    // Stale (20 minutes ago)
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString().replace('Z', '').split('.')[0];
    expect(isCacheStale(twentyMinAgo)).toBe(true);

    // Edge: exactly 15 minutes (should be stale)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000 - 1).toISOString().replace('Z', '').split('.')[0];
    expect(isCacheStale(fifteenMinAgo)).toBe(true);
  });

  it('should consider cache fresh within 15 minutes', () => {
    const CACHE_STALENESS_MS = 15 * 60 * 1000;
    const isCacheStale = (fetchedAt: string) => {
      const fetchedTime = new Date(fetchedAt + 'Z').getTime();
      return Date.now() - fetchedTime > CACHE_STALENESS_MS;
    };

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('Z', '').split('.')[0];
    expect(isCacheStale(tenMinAgo)).toBe(false);
  });
});

describe('Price Service - FX Pair Normalization', () => {
  it('should normalize FX pairs correctly', () => {
    const normalizePair = (from: string, to: string) => `${from.toUpperCase()}${to.toUpperCase()}`;

    expect(normalizePair('eur', 'usd')).toBe('EURUSD');
    expect(normalizePair('USD', 'EUR')).toBe('USDEUR');
    expect(normalizePair('ngn', 'eur')).toBe('NGNEUR');
  });

  it('should identify same-currency as rate 1', () => {
    const getRate = (from: string, to: string) => {
      if (from.toUpperCase() === to.toUpperCase()) return 1;
      return null; // would fetch
    };

    expect(getRate('USD', 'USD')).toBe(1);
    expect(getRate('eur', 'EUR')).toBe(1);
    expect(getRate('EUR', 'USD')).toBeNull();
  });

  it('should know which pairs need inversion', () => {
    const INVERSE_PAIRS = new Set(['USDEUR', 'USDNGN', 'EURNGN']);

    expect(INVERSE_PAIRS.has('USDEUR')).toBe(true);
    expect(INVERSE_PAIRS.has('EURUSD')).toBe(false);
    expect(INVERSE_PAIRS.has('USDNGN')).toBe(true);
    expect(INVERSE_PAIRS.has('NGNUSD')).toBe(false);
  });
});
