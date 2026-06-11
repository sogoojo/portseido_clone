import TradingView from '@mathieuc/tradingview';

// Live NGX (Nigerian Exchange) prices via TradingView's websocket API.
// Anonymous access — no token needed for plain OHLCV candles.

export interface TvCandle {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface TvDailyResult {
  currency: string | null;
  candles: TvCandle[]; // sorted ascending by date
}

/** TradingView symbol for an NGX ticker ("MTNN" or "NSENG:MTNN" → "NSENG:MTNN"). */
export function tvSymbol(ticker: string): string {
  return ticker.startsWith('NSENG:') ? ticker : `NSENG:${ticker}`;
}

/**
 * Fetch daily candles for one symbol on an existing client. Resolves null on
 * error or timeout — never hangs (hard timeout) and always deletes the chart
 * session. Candles stream in over multiple onUpdate events, so we debounce
 * briefly before settling to capture the full range.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fetchOnClient(client: any, symbol: string, bars: number, timeoutMs: number): Promise<TvDailyResult | null> {
  return new Promise<TvDailyResult | null>(resolve => {
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;

    const settle = (value: TvDailyResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (settleTimer) clearTimeout(settleTimer);
      try {
        chart?.delete();
      } catch {
        // session already gone
      }
      resolve(value && value.candles.length > 0 ? value : null);
    };

    const hardTimeout = setTimeout(() => {
      console.error(`[TradingView] Timeout fetching ${symbol}`);
      settle(null);
    }, timeoutMs);

    try {
      chart = new client.Session.Chart();

      chart.onError((...err: unknown[]) => {
        console.error(`[TradingView] Error for ${symbol}:`, ...err);
        settle(null);
      });

      chart.setMarket(symbol, { timeframe: 'D', range: bars });

      chart.onUpdate(() => {
        if (settled || !chart.periods || chart.periods.length === 0) return;
        // bars keep streaming in — settle 700ms after the last update
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          interface RawPeriod { time: number; open?: number; close: number; max?: number; min?: number; volume?: number }
          const candles: TvCandle[] = (chart.periods as RawPeriod[])
            .map((p: RawPeriod) => ({
              date: new Date(p.time * 1000).toISOString().split('T')[0],
              open: p.open ?? null,
              high: p.max ?? null,
              low: p.min ?? null,
              close: p.close,
              volume: p.volume ?? null,
            }))
            .filter((c: TvCandle) => c.close != null)
            .sort((a: TvCandle, b: TvCandle) => a.date.localeCompare(b.date));
          settle({ currency: chart.infos?.currency_id ?? null, candles });
        }, 700);
      });
    } catch (err) {
      console.error(`[TradingView] Setup failed for ${symbol}:`, err);
      settle(null);
    }
  });
}

/** Fetch up to `bars` daily candles for one symbol. Null on error/timeout. */
export async function fetchTvDailyCandles(
  symbol: string,
  bars: number,
  timeoutMs = 12000
): Promise<TvDailyResult | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any = null;
  try {
    client = new TradingView.Client();
    return await fetchOnClient(client, symbol, bars, timeoutMs);
  } catch (err) {
    console.error(`[TradingView] Client failed for ${symbol}:`, err);
    return null;
  } finally {
    try {
      await client?.end();
    } catch {
      // socket already closed
    }
  }
}

/**
 * Fetch daily candles for several symbols over ONE websocket connection
 * (sequentially — far cheaper than a client per symbol). Symbols that fail
 * are simply absent from the result map.
 */
export async function fetchTvDailyCandlesMulti(
  symbols: string[],
  bars: number,
  perSymbolTimeoutMs = 10000
): Promise<Map<string, TvDailyResult>> {
  const results = new Map<string, TvDailyResult>();
  if (symbols.length === 0) return results;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any = null;
  try {
    client = new TradingView.Client();
    for (const symbol of symbols) {
      const result = await fetchOnClient(client, symbol, bars, perSymbolTimeoutMs);
      if (result) results.set(symbol, result);
    }
  } catch (err) {
    console.error('[TradingView] Batch fetch failed:', err);
  } finally {
    try {
      await client?.end();
    } catch {
      // socket already closed
    }
  }
  return results;
}
