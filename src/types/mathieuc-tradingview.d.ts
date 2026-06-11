// @mathieuc/tradingview ships no type definitions — minimal surface we use
declare module '@mathieuc/tradingview' {
  interface ChartPeriod {
    time: number; // unix seconds
    open: number;
    close: number;
    max: number;
    min: number;
    volume: number;
  }

  interface ChartInfos {
    description?: string;
    currency_id?: string;
    full_name?: string;
  }

  class ChartSession {
    infos: ChartInfos;
    periods: ChartPeriod[];
    setMarket(symbol: string, options?: { timeframe?: string; range?: number; to?: number }): void;
    onSymbolLoaded(cb: () => void): void;
    onUpdate(cb: () => void): void;
    onError(cb: (...err: unknown[]) => void): void;
    delete(): void;
  }

  class Client {
    constructor(options?: { token?: string; signature?: string });
    Session: { Chart: new () => ChartSession };
    end(): Promise<void>;
  }

  const TradingView: { Client: typeof Client };
  export default TradingView;
  export { Client };
}
