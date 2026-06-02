'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface HistoricalReturn {
  period: string;
  return_pct: number;
}

interface HistoricalReturnChartProps {
  data: HistoricalReturn[];
  onGranularityChange: (g: 'monthly' | 'quarterly' | 'annually') => void;
  granularity: 'monthly' | 'quarterly' | 'annually';
}

const GRANULARITIES = [
  { key: 'monthly' as const, label: 'Monthly' },
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
];

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload || !payload[0]) return null;
  const value = payload[0].value;
  const color = value >= 0 ? '#16a34a' : '#dc2626';
  const sign = value >= 0 ? '+' : '';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-sm">
      <p className="text-gray-500">{label}</p>
      <p className="font-semibold tabular-nums" style={{ color }}>
        {sign}{value.toFixed(2)}%
      </p>
    </div>
  );
}

export default function HistoricalReturnChart({ data, onGranularityChange, granularity }: HistoricalReturnChartProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700">Historical Returns</h3>
        <div className="flex gap-1">
          {GRANULARITIES.map(g => (
            <button
              key={g.key}
              onClick={() => onGranularityChange(g.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                granularity === g.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          No historical data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="return_pct" radius={[2, 2, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.return_pct >= 0 ? '#16a34a' : '#dc2626'}
                  fillOpacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
