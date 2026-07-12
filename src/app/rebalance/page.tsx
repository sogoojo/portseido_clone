'use client';

import { useState, useEffect } from 'react';
import type { RebalanceResult, RebalanceRow, RebalanceStatus } from '@/lib/types';

const TIER_LABEL: Record<number, string> = { 1: 'Stability', 2: 'Growth', 3: 'Speculative' };

const STATUS_STYLE: Record<RebalanceStatus, { row: string; text: string; label: string }> = {
  underweight: { row: 'bg-green-50/50', text: 'text-green-700', label: 'Underweight' },
  overweight: { row: 'bg-red-50/50', text: 'text-red-700', label: 'Overweight' },
  on_target: { row: '', text: 'text-gray-500', label: 'On target' },
  untracked: { row: 'bg-gray-50', text: 'text-gray-400', label: 'No target' },
};

const PRIORITY_STYLE: Record<string, string> = {
  High: 'bg-green-100 text-green-700',
  Medium: 'bg-emerald-50 text-emerald-700',
  Low: 'bg-amber-50 text-amber-700',
  Full: 'bg-gray-100 text-gray-500',
  Add: 'bg-blue-50 text-blue-700',
};

function pct(v: number | null): string {
  if (v == null) return '–';
  return `${v.toFixed(1)}%`;
}

function gapStr(v: number | null): string {
  if (v == null) return '–';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}pp`;
}

function eur(v: number): string {
  return `€${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function Row({ r }: { r: RebalanceRow }) {
  const st = STATUS_STYLE[r.status];
  return (
    <tr className={`border-b border-gray-100 ${st.row}`}>
      <td className="py-2 pl-3 pr-2">
        <div className="font-medium text-gray-900">{r.ticker}</div>
        {r.name && <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{r.name}</div>}
      </td>
      <td className="px-2 text-[11px] text-gray-500">{r.tier ? TIER_LABEL[r.tier] : '–'}</td>
      <td className="px-2 text-right tabular-nums text-gray-700">{pct(r.current_pct)}</td>
      <td className="px-2 text-right tabular-nums text-gray-700">{pct(r.target_pct)}</td>
      <td className={`px-2 text-right tabular-nums font-medium ${r.gap == null ? 'text-gray-400' : r.gap > 0 ? 'text-green-600' : r.gap < 0 ? 'text-red-600' : 'text-gray-500'}`}>
        {gapStr(r.gap)}
      </td>
      <td className="px-2 text-right tabular-nums text-gray-500">{eur(r.value_eur)}</td>
      <td className="px-2">
        {r.priority !== '-' && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[r.priority] ?? 'bg-gray-100 text-gray-500'}`}>
            {r.priority === 'Full' ? 'At target' : r.priority}
          </span>
        )}
      </td>
      <td className={`px-2 pr-3 text-[11px] ${st.text}`}>{st.label}</td>
    </tr>
  );
}

export default function RebalancePage() {
  const [data, setData] = useState<RebalanceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/rebalance')
      .then(r => r.json())
      .then(j => setData(j.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const underweight = data?.rows.filter(r => r.status === 'underweight') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Rebalance</h1>
        {data && (
          <span className="text-[11px] text-gray-400">
            Portfolio {eur(data.total_eur)} · {underweight.length} underweight
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 max-w-2xl">
        Current weight vs your target weight per holding (aggregated across all accounts in EUR).
        <span className="text-green-600 font-medium"> Underweight</span> = room to add;
        <span className="text-red-600 font-medium"> overweight</span> = consider trimming.
        Sorted by biggest gap first.
      </p>

      {loading ? (
        <div className="animate-pulse rounded-lg bg-gray-200 h-64" />
      ) : !data || data.rows.length === 0 ? (
        <p className="text-sm text-gray-500">No data.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-2 pl-3 pr-2 text-left font-medium">Ticker</th>
                <th className="px-2 text-left font-medium">Tier</th>
                <th className="px-2 text-right font-medium">Current</th>
                <th className="px-2 text-right font-medium">Target</th>
                <th className="px-2 text-right font-medium">Gap</th>
                <th className="px-2 text-right font-medium">Value</th>
                <th className="px-2 text-left font-medium">Add</th>
                <th className="px-2 pr-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => <Row key={r.ticker} r={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
