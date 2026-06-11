'use client';

import { useApi } from '@/lib/hooks';

interface PeriodReturn {
  period: string;
  mwr: number | null;
}

interface GainsReturnsPanelProps {
  account: string;
}

const DISPLAY_PERIODS = [
  { key: '1M', label: '1 Month' },
  { key: '3M', label: '3 Months' },
  { key: '6M', label: '6 Months' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1 Year' },
  { key: 'All', label: 'All-Time' },
];

export default function GainsReturnsPanel({ account }: GainsReturnsPanelProps) {
  const { data: body, loading } = useApi<{ data: { portfolio: PeriodReturn[] } }>(
    `/api/performance?account=${account}`
  );
  const returns = body?.data?.portfolio || [];

  if (loading) {
    return (
      <div className="space-y-2">
        {DISPLAY_PERIODS.map(p => (
          <div key={p.key} className="flex justify-between py-1.5">
            <div className="h-4 w-16 animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-12 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  const returnMap = new Map(returns.map(r => [r.period, r.mwr]));

  return (
    <div className="divide-y divide-gray-100">
      {DISPLAY_PERIODS.map(p => {
        const mwr = returnMap.get(p.key);
        const value = mwr != null ? mwr * 100 : null;
        const color = value == null ? 'text-gray-400' : value >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';
        const sign = value != null && value >= 0 ? '+' : '';
        return (
          <div key={p.key} className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-600">{p.label}</span>
            <span className={`text-sm font-medium tabular-nums ${color}`}>
              {value != null ? `${sign}${value.toFixed(2)}%` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
