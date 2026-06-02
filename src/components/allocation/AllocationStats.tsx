'use client';

interface AllocationStatsProps {
  totalValue: number;
  holdingsCount: number;
  cashBalance: number;
  currency: string;
}

function formatMoney(value: number, currency?: string): string {
  const sym = currency === 'EUR' ? '€' : currency === 'NGN' ? '₦' : '$';
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  return `${sign}${sym}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AllocationStats({ totalValue, holdingsCount, cashBalance, currency }: AllocationStatsProps) {
  const cashPct = totalValue > 0 ? (cashBalance / totalValue) * 100 : 0;

  const stats = [
    { label: 'Portfolio Value', value: formatMoney(totalValue, currency) },
    { label: 'Holdings', value: holdingsCount.toString() },
    { label: 'Cash', value: formatMoney(cashBalance, currency) },
    { label: 'Cash %', value: `${cashPct.toFixed(1)}%` },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map(s => (
        <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wider">{s.label}</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900 mt-1">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
