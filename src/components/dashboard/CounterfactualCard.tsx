'use client';

import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';

interface CounterfactualData {
  counterfactual_value: number;
  your_value: number;
  total_deposited: number;
  difference: number;
  difference_pct: number;
  counterfactual_return_pct: number;
  your_return_pct: number;
  currency: string;
}

function formatMoney(value: number): string {
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CounterfactualCard() {
  const searchParams = useSearchParams();
  const account = searchParams.get('account') || 'all';
  const { data: body, loading } = useApi<{ data: CounterfactualData }>(
    `/api/portfolio/counterfactual?account=${account}`
  );
  const data = body?.data || null;

  if (loading) {
    return <div className="animate-pulse rounded-lg bg-gray-200 h-32" />;
  }

  // No deposits recorded (or fetch failed): the comparison is meaningless
  if (!data || data.total_deposited === 0) {
    return null;
  }

  const beating = data.difference >= 0;
  const beatColor = beating ? 'text-[#16a34a]' : 'text-[#dc2626]';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
        What if S&P 500?
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-400">Your Portfolio</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">{formatMoney(data.your_value)}</p>
          <p className={`text-sm tabular-nums ${data.your_return_pct >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            {data.your_return_pct >= 0 ? '+' : ''}{data.your_return_pct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">If S&P 500</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">{formatMoney(data.counterfactual_value)}</p>
          <p className={`text-sm tabular-nums ${data.counterfactual_return_pct >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            {data.counterfactual_return_pct >= 0 ? '+' : ''}{data.counterfactual_return_pct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{beating ? 'You beat S&P by' : 'S&P beat you by'}</p>
          <p className={`text-lg font-semibold tabular-nums ${beatColor}`}>
            {formatMoney(Math.abs(data.difference))}
          </p>
          <p className={`text-sm tabular-nums ${beatColor}`}>
            {Math.abs(data.difference_pct).toFixed(2)}%
          </p>
        </div>
      </div>
    </div>
  );
}
