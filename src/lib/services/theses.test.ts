import { describe, it, expect } from 'vitest';
import { evaluateTrigger, type TriggerContext } from './theses';
import type { DailySummary, ThesisTrigger } from '@/lib/types';

const baseSummary: DailySummary = {
  ticker: 'X', date: '2026-06-27', open: null, high: null, low: null, close: 100,
  previous_close: null, change: null, change_pct: null, volume: null, market_cap: null,
  currency: 'USD', news: [], recommendation_key: null, recommendation_mean: null,
  analyst_count: null, target_mean: null, target_high: null, target_low: null,
  forward_pe: null, peg_ratio: null, beta: null, short_ratio: null,
  fifty_two_week_change: null, earnings_surprise_pct: null, insider_net_shares: null,
  rating_changes: [], recommendation_trend: [], earnings_trend: [], fetched_at: '',
};

const noData: TriggerContext = { price: null, ma50: null, ma200: null, summary: null };
const auto = (metric: ThesisTrigger['metric'], extra: Partial<ThesisTrigger> = {}): ThesisTrigger => ({
  id: '1', text: 't', kind: 'auto', metric, ...extra,
});
const withSummary = (s: DailySummary): TriggerContext => ({ price: null, ma50: null, ma200: null, summary: s });

describe('evaluateTrigger — price/trend', () => {
  it('below_200d fires when price is under the 200-day', () => {
    expect(evaluateTrigger(auto('below_200d'), { price: 90, ma50: 95, ma200: 100, summary: null }).fired).toBe(true);
  });
  it('below_200d does not fire when above the 200-day', () => {
    expect(evaluateTrigger(auto('below_200d'), { price: 110, ma50: 95, ma200: 100, summary: null }).fired).toBe(false);
  });
  it('below_200d is not evaluatable without price data', () => {
    const r = evaluateTrigger(auto('below_200d'), noData);
    expect(r.evaluatable).toBe(false);
    expect(r.fired).toBe(false);
  });
  it('price_below fires under the threshold', () => {
    expect(evaluateTrigger(auto('price_below', { param: 100 }), { price: 90, ma50: null, ma200: null, summary: null }).fired).toBe(true);
  });
});

describe('evaluateTrigger — fundamentals', () => {
  it('earnings_miss fires on a >5% miss', () => {
    expect(evaluateTrigger(auto('earnings_miss'), withSummary({ ...baseSummary, earnings_surprise_pct: -0.08 })).fired).toBe(true);
  });
  it('earnings_miss does not fire on a beat', () => {
    expect(evaluateTrigger(auto('earnings_miss'), withSummary({ ...baseSummary, earnings_surprise_pct: 0.05 })).fired).toBe(false);
  });
  it('eps_revisions_down fires when downgrades outnumber upgrades on forward periods', () => {
    const s = { ...baseSummary, earnings_trend: [{ period: '+1y', growth: 0.1, eps_up_30d: 1, eps_down_30d: 4 }] };
    expect(evaluateTrigger(auto('eps_revisions_down'), withSummary(s)).fired).toBe(true);
  });
  it('eps_revisions_down does not fire when upgrades lead', () => {
    const s = { ...baseSummary, earnings_trend: [{ period: '+1y', growth: 0.1, eps_up_30d: 5, eps_down_30d: 1 }] };
    expect(evaluateTrigger(auto('eps_revisions_down'), withSummary(s)).fired).toBe(false);
  });
  it('analyst_downgrade fires on a recent down action', () => {
    const s = { ...baseSummary, rating_changes: [{ date: '2026-06-20', firm: 'Acme', from_grade: 'buy', to_grade: 'hold', action: 'down' }] };
    expect(evaluateTrigger(auto('analyst_downgrade'), withSummary(s)).fired).toBe(true);
  });
});

describe('evaluateTrigger — manual', () => {
  it('reflects the user-set fired flag and is not auto-evaluatable', () => {
    const m: ThesisTrigger = { id: '2', text: 'NRR < 115% two quarters', kind: 'manual', fired: true };
    const r = evaluateTrigger(m, noData);
    expect(r.fired).toBe(true);
    expect(r.evaluatable).toBe(false);
  });
});
