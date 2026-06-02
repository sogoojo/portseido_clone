'use client';

import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { PortfolioHolding } from '@/lib/types';

const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#a855f7', '#0ea5e9', '#eab308',
  '#22c55e',
];

type ViewMode = 'market_value' | 'cost' | 'gain' | 'loss';
type GroupMode = 'holding' | 'sector';

interface AllocationPieProps {
  holdings: PortfolioHolding[];
  cashBalance: number;
  defaultGroupMode?: GroupMode;
  title?: string;
}

function formatMoney(value: number): string {
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function normalizeSector(holding: PortfolioHolding): string {
  if (holding.sector) return holding.sector;
  if (holding.ticker.startsWith('NSENG:') || holding.ticker.includes('NGX')) return 'Nigerian Equities';
  if (['BTC-USD', 'ETH-USD'].includes(holding.ticker) || holding.ticker.endsWith('-USD')) return 'Cryptocurrency';
  return 'Other';
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { pct: number } }> }) {
  if (!active || !payload || !payload[0]) return null;
  const { name, value, payload: data } = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-900">{name}</p>
      <p className="tabular-nums text-gray-700">{formatMoney(value)}</p>
      <p className="tabular-nums text-gray-500">{data.pct.toFixed(1)}%</p>
    </div>
  );
}

const RADIAN = Math.PI / 180;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, pct, name } = props as {
    cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; pct: number; name: string;
  };
  if (pct < 4) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.4;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#374151" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight={500}>
      {name.length > 10 ? name.slice(0, 10) + '…' : name} {pct.toFixed(0)}%
    </text>
  );
}

export default function AllocationPie({ holdings, cashBalance, defaultGroupMode = 'holding', title }: AllocationPieProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('market_value');
  const [groupMode, setGroupMode] = useState<GroupMode>(defaultGroupMode);
  const [hoveredIndex, setHoveredIndex] = useState<number | undefined>(undefined);

  const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
    { key: 'market_value', label: 'Market Value' },
    { key: 'cost', label: 'Cost' },
    { key: 'gain', label: 'Gain' },
    { key: 'loss', label: 'Loss' },
  ];

  function buildPieData() {
    let items: { name: string; value: number }[] = [];

    if (groupMode === 'holding') {
      items = holdings.map(h => {
        let value: number;
        switch (viewMode) {
          case 'cost': value = h.cost_basis; break;
          case 'gain': value = Math.max(0, h.unrealised_gain); break;
          case 'loss': value = Math.abs(Math.min(0, h.unrealised_gain)); break;
          default: value = h.market_value;
        }
        return { name: h.ticker, value };
      });
    } else {
      const sectorMap = new Map<string, number>();
      for (const h of holdings) {
        const sector = normalizeSector(h);
        let value: number;
        switch (viewMode) {
          case 'cost': value = h.cost_basis; break;
          case 'gain': value = Math.max(0, h.unrealised_gain); break;
          case 'loss': value = Math.abs(Math.min(0, h.unrealised_gain)); break;
          default: value = h.market_value;
        }
        sectorMap.set(sector, (sectorMap.get(sector) || 0) + value);
      }
      items = Array.from(sectorMap.entries()).map(([name, value]) => ({ name, value }));
    }

    if (viewMode === 'market_value' && cashBalance > 0) {
      items.push({ name: 'Cash', value: cashBalance });
    }

    return items
      .filter(i => i.value > 0.01)
      .sort((a, b) => b.value - a.value)
      .map(i => {
        const total = items.reduce((s, x) => s + Math.max(0, x.value), 0);
        return { ...i, pct: total > 0 ? (i.value / total) * 100 : 0 };
      });
  }

  const pieData = buildPieData();
  const totalValue = pieData.reduce((s, d) => s + d.value, 0);

  const hoveredItem = hoveredIndex != null ? pieData[hoveredIndex] : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      {/* Title + group mode toggle */}
      <div className="flex items-center justify-between mb-3">
        {title ? (
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        ) : (
          <div className="flex gap-1">
            <button
              onClick={() => setGroupMode('holding')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                groupMode === 'holding' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              By Holding
            </button>
            <button
              onClick={() => setGroupMode('sector')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                groupMode === 'sector' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              By Sector
            </button>
          </div>
        )}
      </div>

      {pieData.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
          No allocation data for this view
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={80}
                outerRadius={115}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                label={renderLabel}
                strokeWidth={0}
                onMouseLeave={() => setHoveredIndex(undefined)}
              >
                {pieData.map((_, index) => (
                  <Cell
                    key={index}
                    fill={COLORS[index % COLORS.length]}
                    style={{ transition: 'opacity 0.2s, transform 0.2s', cursor: 'pointer' }}
                    opacity={hoveredIndex != null && hoveredIndex !== index ? 0.5 : 1}
                    onMouseEnter={() => setHoveredIndex(index)}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              {hoveredItem ? (
                <>
                  <p className="text-xs text-gray-400 truncate max-w-[100px]">{hoveredItem.name}</p>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{formatMoney(hoveredItem.value)}</p>
                  <p className="text-xs tabular-nums text-gray-500">{hoveredItem.pct.toFixed(1)}%</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400 uppercase">Total</p>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{formatMoney(totalValue)}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* View mode toggles */}
      <div className="flex justify-center gap-1 mt-2">
        {VIEW_OPTIONS.map(v => (
          <button
            key={v.key}
            onClick={() => setViewMode(v.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === v.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
