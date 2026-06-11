'use client';

import { useState } from 'react';
import GainsReturnsPanel from './GainsReturnsPanel';
import { useApi } from '@/lib/hooks';

interface AllTimePnL {
  unrealised: number;
  realised: number;
  dividends: number;
  total: number;
  total_pct: number | null;
}

interface BenchmarkQuote {
  ticker: string;
  price: number | null;
  currency: string;
  change?: number | null;
  changePct?: number | null;
}

interface InfoTabsProps {
  account: string;
  allTimePnl?: AllTimePnL;
  currency: string;
}

type Tab = 'returns' | 'pnl' | 'benchmark';

function formatMoney(value: number, currency?: string): string {
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = currency === 'EUR' ? '€' : currency === 'NGN' ? '₦' : '$';
  return `${sign}${sym}${formatted}`;
}

export default function InfoTabs({ account, allTimePnl, currency }: InfoTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('returns');
  const { data: benchBody, loading: benchLoading, error: benchError } =
    useApi<{ data: BenchmarkQuote[] }>('/api/prices?tickers=^GSPC,^IXIC');
  const benchmarks = benchBody?.data || [];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'returns', label: 'Gains & Returns' },
    { key: 'pnl', label: 'P&L Breakdown' },
    { key: 'benchmark', label: 'Benchmark' },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 h-full">
      {/* Tab headers */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-3">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content — the returns panel stays mounted so switching tabs
          doesn't refetch the full performance payload every time */}
      <div className={activeTab === 'returns' ? '' : 'hidden'}>
        <GainsReturnsPanel account={account} />
      </div>

      {activeTab === 'pnl' && allTimePnl && (
        <div className="space-y-3">
          {[
            { label: 'Unrealised Gain', value: allTimePnl.unrealised },
            { label: 'Realised Gain', value: allTimePnl.realised },
            { label: 'Dividends', value: allTimePnl.dividends },
          ].map(item => {
            const color = item.value >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';
            const sign = item.value >= 0 ? '+' : '';
            return (
              <div key={item.label} className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-sm text-gray-600">{item.label}</span>
                <span className={`text-sm font-medium tabular-nums ${color}`}>
                  {sign}{formatMoney(item.value, currency)}
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm font-semibold text-gray-900">Total P&L</span>
            <span className={`text-base font-bold tabular-nums ${allTimePnl.total >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
              {allTimePnl.total >= 0 ? '+' : ''}{formatMoney(allTimePnl.total, currency)}
            </span>
          </div>
          <div className="text-right">
            <span className={`text-xs tabular-nums ${(allTimePnl.total_pct ?? 0) >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
              {allTimePnl.total_pct != null ? `${allTimePnl.total_pct >= 0 ? '+' : ''}${allTimePnl.total_pct.toFixed(2)}%` : '—'}
            </span>
          </div>
        </div>
      )}

      {activeTab === 'pnl' && !allTimePnl && (
        <p className="text-sm text-gray-400 py-4 text-center">No P&L data available</p>
      )}

      {activeTab === 'benchmark' && (
        <div className="space-y-3">
          {benchLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading benchmarks...</p>
          ) : benchError || benchmarks.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Benchmarks unavailable</p>
          ) : (
            benchmarks.map(b => (
              <div key={b.ticker} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {b.ticker === '^GSPC' ? 'S&P 500' : b.ticker === '^IXIC' ? 'NASDAQ' : b.ticker}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums text-gray-900">
                    {b.price != null ? b.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </p>
                  {b.changePct != null && (
                    <p className={`text-xs tabular-nums ${(b.changePct ?? 0) >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
                      {(b.changePct ?? 0) >= 0 ? '+' : ''}{(b.changePct ?? 0).toFixed(2)}%
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
