'use client';

interface PnL {
  amount: number;
  pct: number;
}

interface PortfolioSummaryProps {
  totalValueEur?: number;
  totalValueUsd?: number;
  value?: number;
  currency?: string;
  isAggregate: boolean;
  todayPnL: PnL;
  allTimeGain: number;
  allTimeGainPct: number;
  totalDeposited: number;
}

function formatMoney(value: number, currency?: string): string {
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = currency === 'EUR' ? '€' : currency === 'NGN' ? '₦' : '$';
  return `${sign}${sym}${formatted}`;
}

export default function PortfolioSummary({
  totalValueEur,
  totalValueUsd,
  value,
  currency,
  isAggregate,
  todayPnL,
  allTimeGain,
  allTimeGainPct,
  totalDeposited,
}: PortfolioSummaryProps) {
  const displayCurrency = isAggregate ? 'USD' : currency || 'USD';
  const gainColor = allTimeGain >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';
  const gainSign = allTimeGain >= 0 ? '+' : '';
  const todayColor = todayPnL.amount >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';
  const todaySign = todayPnL.amount >= 0 ? '+' : '';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      {/* Total value */}
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Portfolio Value</p>
      {isAggregate ? (
        <>
          <p className="text-3xl font-bold tabular-nums text-gray-900">
            {formatMoney(totalValueUsd || 0, 'USD')}
          </p>
          <p className="text-base tabular-nums text-gray-400 mt-0.5">
            {formatMoney(totalValueEur || 0, 'EUR')}
          </p>
        </>
      ) : (
        <p className="text-3xl font-bold tabular-nums text-gray-900">
          {formatMoney(value || 0, currency)}
        </p>
      )}

      {/* Today's change inline */}
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-sm font-medium tabular-nums ${todayColor}`}>
          {todaySign}{formatMoney(todayPnL.amount, displayCurrency)}
        </span>
        <span className={`text-sm tabular-nums ${todayColor}`}>
          ({todaySign}{todayPnL.pct.toFixed(2)}%)
        </span>
        <span className="text-xs text-gray-400">today</span>
      </div>

      {/* Invested + All-time gain */}
      <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Invested</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900 mt-0.5">
            {formatMoney(totalDeposited, displayCurrency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">All-Time Gain</p>
          <p className={`text-lg font-semibold tabular-nums mt-0.5 ${gainColor}`}>
            {gainSign}{formatMoney(allTimeGain, displayCurrency)}
          </p>
          <p className={`text-xs tabular-nums ${gainColor}`}>
            {gainSign}{allTimeGainPct.toFixed(2)}%
          </p>
        </div>
      </div>
    </div>
  );
}
