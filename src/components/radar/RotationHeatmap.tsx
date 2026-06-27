'use client';

import { Fragment, useState } from 'react';
import type { ThemeRotation, Constituent, Stage } from '@/lib/services/rotation';

function pct(v: number | null, withSign = false): string {
  if (v == null) return '—';
  const s = (v * 100).toFixed(1) + '%';
  return withSign && v > 0 ? '+' + s : s;
}

// Heat colour for a return / relative-strength cell.
function heat(v: number | null): string {
  if (v == null) return 'text-gray-400';
  if (v >= 0.15) return 'text-green-700 font-semibold';
  if (v > 0) return 'text-green-600';
  if (v <= -0.15) return 'text-red-700 font-semibold';
  return 'text-red-600';
}

const STAGE_STYLE: Record<Stage, { label: string; cls: string }> = {
  early: { label: 'Early', cls: 'bg-green-100 text-green-700' },
  extended: { label: 'Extended', cls: 'bg-amber-100 text-amber-700' },
  late: { label: 'Late', cls: 'bg-red-100 text-red-700' },
  weak: { label: 'Lagging', cls: 'bg-gray-100 text-gray-500' },
};

function ConstituentTable({ rows }: { rows: Constituent[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-400">
          <th className="px-2 py-1 text-left font-medium">Stock</th>
          <th className="px-2 py-1 text-right font-medium">5D</th>
          <th className="px-2 py-1 text-right font-medium">1M</th>
          <th className="px-2 py-1 text-right font-medium">3M</th>
          <th className="px-2 py-1 text-right font-medium">6M</th>
          <th className="px-2 py-1 text-right font-medium">vs S&amp;P</th>
          <th className="px-2 py-1 text-right font-medium" title="Extension above the 50-day average">
            vs 50d
          </th>
          <th className="px-2 py-1 text-center font-medium">Stage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.ticker} className="border-t border-gray-100">
            <td className="px-2 py-1 font-medium text-gray-800">{c.ticker}</td>
            <td className={`px-2 py-1 text-right tabular-nums ${heat(c.ret_5d)}`}>{pct(c.ret_5d, true)}</td>
            <td className={`px-2 py-1 text-right tabular-nums ${heat(c.ret_1m)}`}>{pct(c.ret_1m, true)}</td>
            <td className={`px-2 py-1 text-right tabular-nums ${heat(c.ret_3m)}`}>{pct(c.ret_3m, true)}</td>
            <td className={`px-2 py-1 text-right tabular-nums ${heat(c.ret_6m)}`}>{pct(c.ret_6m, true)}</td>
            <td className={`px-2 py-1 text-right tabular-nums font-semibold ${heat(c.rs_3m)}`}>
              {pct(c.rs_3m, true)}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums ${heat(c.ext50)}`}>{pct(c.ext50, true)}</td>
            <td className="px-2 py-1 text-center">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STAGE_STYLE[c.stage].cls}`}>
                {STAGE_STYLE[c.stage].label}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RotationHeatmap({ themes }: { themes: ThemeRotation[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Sector &amp; Theme Rotation</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Ranked by relative strength vs the S&amp;P 500 (weighted 3M&gt;1M&gt;6M). Top rows are
          where money is flowing now. Click a basket to drill into its stocks.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="px-4 py-2 text-left font-medium">Theme</th>
              <th className="px-3 py-2 text-right font-medium">5D</th>
              <th className="px-3 py-2 text-right font-medium">1M</th>
              <th className="px-3 py-2 text-right font-medium">3M</th>
              <th className="px-3 py-2 text-right font-medium">6M</th>
              <th className="px-3 py-2 text-right font-medium" title="3-month return minus the S&P 500">
                vs S&amp;P (3M)
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Share of members above their 50-day average">
                Breadth
              </th>
              <th className="px-3 py-2 text-center font-medium">Stage</th>
            </tr>
          </thead>
          <tbody>
            {themes.map((t) => {
              // Only leaders drill down — a lagging theme just shows its flag.
              const expandable = t.constituents.length > 1 && t.stage !== 'weak';
              const isOpen = open.has(t.key);
              return (
                <Fragment key={t.key}>
                  <tr
                    className={`border-b border-gray-50 hover:bg-gray-50 ${expandable ? 'cursor-pointer' : ''}`}
                    onClick={expandable ? () => toggle(t.key) : undefined}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {expandable && (
                          <span className="w-3 text-gray-400">{isOpen ? '▾' : '▸'}</span>
                        )}
                        <span className="font-medium text-gray-900">{t.name}</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                          {t.group}
                        </span>
                      </div>
                      <div className={`text-[11px] text-gray-400 ${expandable ? 'pl-5' : ''}`}>
                        {t.members.join(', ')}
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${heat(t.ret_5d)}`}>{pct(t.ret_5d, true)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${heat(t.ret_1m)}`}>{pct(t.ret_1m, true)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${heat(t.ret_3m)}`}>{pct(t.ret_3m, true)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${heat(t.ret_6m)}`}>{pct(t.ret_6m, true)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${heat(t.rs_3m)}`}>
                      {pct(t.rs_3m, true)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-gray-400"
                            style={{ width: `${Math.round((t.breadth ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-xs tabular-nums text-gray-500">
                          {t.breadth == null ? '—' : Math.round(t.breadth * 100) + '%'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STAGE_STYLE[t.stage].cls}`}>
                        {STAGE_STYLE[t.stage].label}
                      </span>
                    </td>
                  </tr>
                  {expandable && isOpen && (
                    <tr>
                      <td colSpan={8} className="bg-gray-50 px-4 py-2">
                        <ConstituentTable rows={t.constituents} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
