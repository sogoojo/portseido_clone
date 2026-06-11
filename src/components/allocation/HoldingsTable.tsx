'use client';

import { useState } from 'react';
import type { PortfolioHolding } from '@/lib/types';

interface HoldingsTableProps {
  holdings: PortfolioHolding[];
  currency?: string;
}

type SortKey =
  | 'ticker' | 'name' | 'sector' | 'allocation_pct'
  | 'current_price' | 'avg_cost' | 'day_gain_pct'
  | 'unrealised_gain_pct' | 'unrealised_gain' | 'market_value' | 'quantity';

type SortDir = 'asc' | 'desc';

function fmt(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function currencySymbol(currency?: string): string {
  return currency === 'EUR' ? '€' : currency === 'NGN' ? '₦' : '$';
}

function fmtMoney(value: number, currency?: string): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${currencySymbol(currency)}${fmt(abs)}`;
}

function fmtPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmt(value)}%`;
}

function fmtShares(value: number): string {
  if (value === Math.floor(value)) return value.toString();
  if (value >= 1) return fmt(value, 2);
  return fmt(value, 6); // crypto or fractional
}

function gainColor(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-500';
}

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'ticker', label: 'Ticker', align: 'left' },
  { key: 'name', label: 'Name', align: 'left' },
  { key: 'sector', label: 'Sector', align: 'left' },
  { key: 'allocation_pct', label: 'Alloc %', align: 'right' },
  { key: 'current_price', label: 'Last Price', align: 'right' },
  { key: 'avg_cost', label: 'Avg Cost', align: 'right' },
  { key: 'day_gain_pct', label: '1D Gain %', align: 'right' },
  { key: 'unrealised_gain_pct', label: 'Unrl Gain %', align: 'right' },
  { key: 'unrealised_gain', label: 'Unrl Gain', align: 'right' },
  { key: 'market_value', label: 'Market Value', align: 'right' },
  { key: 'quantity', label: 'Shares', align: 'right' },
];

export default function HoldingsTable({ holdings, currency }: HoldingsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...holdings].sort((a, b) => {
    let av: string | number = a[sortKey] ?? '';
    let bv: string | number = b[sortKey] ?? '';
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    av = Number(av) || 0;
    bv = Number(bv) || 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  // Totals
  const totals = holdings.reduce(
    (acc, h) => ({
      market_value: acc.market_value + h.market_value,
      cost_basis: acc.cost_basis + h.cost_basis,
      unrealised_gain: acc.unrealised_gain + h.unrealised_gain,
      day_gain: acc.day_gain + h.day_gain,
    }),
    { market_value: 0, cost_basis: 0, unrealised_gain: 0, day_gain: 0 }
  );

  const totalMV = totals.market_value;
  const totalGainPct = totals.cost_basis > 0 ? (totals.unrealised_gain / totals.cost_basis) * 100 : 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {COLUMNS.map(col => (
              <th
                key={col.key}
                scope="col"
                tabIndex={0}
                onClick={() => handleSort(col.key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(col.key); } }}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`px-3 py-2.5 font-medium text-gray-500 cursor-pointer select-none hover:text-gray-900 whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1 text-gray-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Holdings rows */}
          {sorted.map(h => (
            <tr key={`${h.account_id}-${h.ticker}`} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">{h.ticker}</td>
              <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{h.name || '—'}</td>
              <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{h.sector || 'Other'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(h.allocation_pct)}%</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtMoney(h.current_price, h.currency || currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtMoney(h.avg_cost, h.currency || currency)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${gainColor(h.day_gain_pct)}`}>{fmtPct(h.day_gain_pct)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${gainColor(h.unrealised_gain_pct)}`}>{fmtPct(h.unrealised_gain_pct)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${gainColor(h.unrealised_gain)}`}>{fmtMoney(h.unrealised_gain, h.currency || currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{fmtMoney(h.market_value, h.currency || currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtShares(h.quantity)}</td>
            </tr>
          ))}
        </tbody>

        {/* Footer totals */}
        <tfoot>
          <tr className="border-t border-gray-300 bg-gray-50 font-medium">
            <td className="px-3 py-2.5 text-gray-900">Total</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">100.00%</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5" />
            <td className={`px-3 py-2.5 text-right tabular-nums ${gainColor(totalGainPct)}`}>{fmtPct(totalGainPct)}</td>
            <td className={`px-3 py-2.5 text-right tabular-nums ${gainColor(totals.unrealised_gain)}`}>{fmtMoney(totals.unrealised_gain, currency)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{fmtMoney(totalMV, currency)}</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
