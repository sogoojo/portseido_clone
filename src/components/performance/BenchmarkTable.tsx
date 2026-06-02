'use client';

interface PeriodReturn {
  period: string;
  mwr?: number;
  return_pct?: number;
}

interface BenchmarkTableProps {
  portfolio: PeriodReturn[];
  sp500: PeriodReturn[];
  nasdaq: PeriodReturn[];
}

const DISPLAY_PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', 'All'];

function getReturnForPeriod(returns: PeriodReturn[], period: string): number | null {
  const r = returns.find(x => x.period === period);
  if (!r) return null;
  return r.mwr != null ? r.mwr * 100 : r.return_pct ?? null;
}

function ReturnCell({ value, isWorst }: { value: number | null; isWorst: boolean }) {
  if (value === null || value === 0) {
    return <td className="px-3 py-2.5 text-center text-sm tabular-nums text-gray-400">—</td>;
  }

  const color = value >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';
  const weight = isWorst ? 'font-bold' : 'font-medium';
  const sign = value >= 0 ? '+' : '';

  return (
    <td className={`px-3 py-2.5 text-center text-sm tabular-nums ${color} ${weight}`}>
      {sign}{value.toFixed(2)}%
    </td>
  );
}

export default function BenchmarkTable({ portfolio, sp500, nasdaq }: BenchmarkTableProps) {
  // Pre-compute values and find worst per column
  const rows = [
    { label: 'Portfolio', data: portfolio, isMwr: true },
    { label: 'S&P 500', data: sp500, isMwr: false },
    { label: 'NASDAQ', data: nasdaq, isMwr: false },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Benchmark
            </th>
            {DISPLAY_PERIODS.map(p => (
              <th key={p} className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map(row => (
            <tr key={row.label} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 text-sm font-medium text-gray-900 whitespace-nowrap">
                {row.label}
              </td>
              {DISPLAY_PERIODS.map(period => {
                const value = getReturnForPeriod(row.data, period);

                // Find worst (most negative) value in this column
                const colValues = rows.map(r => getReturnForPeriod(r.data, period)).filter(v => v !== null) as number[];
                const minVal = colValues.length > 0 ? Math.min(...colValues) : null;
                const isWorst = value !== null && minVal !== null && value === minVal && value < 0;

                return <ReturnCell key={period} value={value} isWorst={isWorst} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
