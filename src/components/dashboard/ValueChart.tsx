'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from 'recharts';

interface DataPoint {
  date: string;
  portfolio_value: number;
  sp500_normalized: number;
  deposits_cumulative: number;
}

const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'All'] as const;

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-sm">
      <p className="text-gray-500 mb-1">{label}</p>
      {payload.map((p, i) => {
        const name = p.dataKey === 'portfolio_value' ? 'Portfolio'
          : p.dataKey === 'sp500_normalized' ? 'S&P 500'
          : 'Deposits';
        return (
          <p key={i} className="tabular-nums" style={{ color: p.color }}>
            {name}: ${p.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        );
      })}
    </div>
  );
}

export default function ValueChart() {
  const searchParams = useSearchParams();
  const account = searchParams.get('account') || 'all';
  const [range, setRange] = useState<string>('1Y');
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portfolio/history?account=${account}&range=${range}`)
      .then(r => r.json())
      .then(json => { if (json.data) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [account, range]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700">Portfolio Value Over Time</h3>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse bg-gray-100 rounded h-64" />
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
          No data available for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickFormatter={(d: string) => {
                const date = new Date(d);
                return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
              }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickFormatter={formatValue}
              width={65}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Deposits area (light grey) */}
            <Area
              type="monotone"
              dataKey="deposits_cumulative"
              stroke="#d1d5db"
              fill="#f3f4f6"
              strokeWidth={1}
              dot={false}
            />
            {/* Portfolio area */}
            <Area
              type="monotone"
              dataKey="portfolio_value"
              stroke="#2563eb"
              fill="url(#portfolioGrad)"
              strokeWidth={2}
              dot={false}
            />
            {/* S&P 500 line */}
            <Line
              type="monotone"
              dataKey="sp500_normalized"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-blue-600" /> Portfolio
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-amber-500 border-dashed" style={{ borderTop: '1.5px dashed #f59e0b', height: 0 }} /> S&P 500
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-gray-100 border border-gray-300 rounded-sm" /> Deposits
        </span>
      </div>
    </div>
  );
}
