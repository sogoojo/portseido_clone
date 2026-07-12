'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
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
  currency?: string;
  defaultGroupMode?: GroupMode;
  title?: string;
  compact?: boolean;
}

export function formatMoney(value: number, currency?: string): string {
  const sym = currency === 'EUR' ? '€' : currency === 'NGN' ? '₦' : '$';
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${sym}${abs.toFixed(2)}`;
}

function normalizeSector(holding: PortfolioHolding): string {
  if (holding.sector) return holding.sector;
  if (holding.ticker.startsWith('NSENG:') || holding.ticker.includes('NGX')) return 'Nigerian Equities';
  if (['BTC-USD', 'ETH-USD'].includes(holding.ticker) || holding.ticker.endsWith('-USD')) return 'Cryptocurrency';
  return 'Other';
}

function CustomTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { pct: number } }>; currency?: string }) {
  if (!active || !payload || !payload[0]) return null;
  const { name, value, payload: data } = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-900">{name}</p>
      <p className="tabular-nums text-gray-700">{formatMoney(value, currency)}</p>
      <p className="tabular-nums text-gray-500">{data.pct.toFixed(1)}%</p>
    </div>
  );
}

const RADIAN = Math.PI / 180;

// Chart geometry — labels are laid out against these values, so they and the
// <Pie> props must stay in sync. Two fixed geometries: the full-size donut and
// the compact broker mini-pie (smaller ring, tighter label spacing/font).
interface PieGeometry {
  height: number;      // chart height; vertical centre is height / 2
  inner: number;       // donut inner radius
  outer: number;       // donut outer radius
  ring: number;        // labels live on this ring outside the donut
  minPct: number;      // label slices at or above this percent
  spacing: number;     // min vertical px between labels on one side
  font: number;        // label font size
}
const FULL_GEOM: PieGeometry = { height: 475, inner: 93, outer: 131, ring: 155, minPct: 0.8, spacing: 15, font: 10.5 };
const COMPACT_GEOM: PieGeometry = { height: 300, inner: 52, outer: 78, ring: 96, minPct: 0, spacing: 12, font: 9 };
// A phone card is narrower than the viewport after main/card padding. Keep the
// ring tight enough for leader labels to remain inside a 360px page.
const MOBILE_GEOM: PieGeometry = { height: 360, inner: 54, outer: 76, ring: 88, minPct: 0.8, spacing: 13, font: 9.5 };

const NARROW_QUERY = '(max-width: 640px)';

function subscribeToNarrowViewport(onStoreChange: () => void): () => void {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

function getNarrowSnapshot(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeToNarrowViewport, getNarrowSnapshot, () => false);
}

interface PieDatum {
  name: string;
  value: number;
  pct: number;
  labelY?: number;
  labelDX?: number; // horizontal offset of the label anchor from the centre
}

/**
 * Portseido-style label layout. Slices run clockwise from 12 o'clock, so
 * each side of the donut is already in top-to-bottom order:
 *  1. place each label at its slice's angle on a ring outside the donut,
 *  2. push labels apart vertically to enforce minimum spacing,
 *  3. derive the label's x from its FINAL y along that same ring —
 *     so labels follow the donut's contour and leader lines stay short and
 *     never slash across neighbouring labels.
 */
function layoutLabels(items: PieDatum[], g: PieGeometry): void {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (total <= 0) return;
  const cy = g.height / 2;

  let cum = 0;
  const positioned = items.map(item => {
    const midDeg = 90 - ((cum + item.value / 2) / total) * 360; // startAngle 90, clockwise
    cum += item.value;
    const rad = -midDeg * RADIAN;
    return { item, cos: Math.cos(rad), idealY: cy + g.ring * Math.sin(rad) };
  }).filter(p => p.item.pct >= g.minPct);

  const rightSide = positioned.filter(p => p.cos >= 0);
  const leftSide = positioned.filter(p => p.cos < 0).reverse(); // make it top→bottom too

  for (const side of [rightSide, leftSide]) {
    // top-down: enforce spacing
    let prevY = -Infinity;
    for (const p of side) {
      p.item.labelY = Math.max(p.idealY, prevY + g.spacing);
      prevY = p.item.labelY;
    }
    // bottom-up: keep everything inside the chart
    let maxY = g.height - 10;
    for (let i = side.length - 1; i >= 0; i--) {
      side[i].item.labelY = Math.min(side[i].item.labelY!, maxY);
      maxY = side[i].item.labelY! - g.spacing;
    }
    // x from final y, walking the label ring
    const dir = side === rightSide ? 1 : -1;
    for (const p of side) {
      const dy = p.item.labelY! - cy;
      const dx = Math.max(Math.sqrt(Math.max(g.ring * g.ring - dy * dy, 0)), 16);
      p.item.labelDX = dir * dx;
    }
  }
}

function makeRenderLabel(g: PieGeometry) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function renderLabel(props: any) {
    const { cx, cy, midAngle, pct, name, labelY, labelDX } = props as {
      cx: number; cy: number; midAngle: number; pct: number; name: string;
      labelY?: number; labelDX?: number;
    };
    if (labelY == null || labelDX == null) return null;

    const rad = -midAngle * RADIAN;
    const isRight = labelDX >= 0;

    // leader line: slice edge → elbow just before the label → label anchor
    const sx = cx + g.outer * Math.cos(rad);
    const sy = cy + g.outer * Math.sin(rad);
    const lx = cx + labelDX;
    const elbowX = lx - (isRight ? 6 : -6);

    const maxNameLength = g === MOBILE_GEOM ? 6 : 12;
    const label = `${name.length > maxNameLength ? name.slice(0, maxNameLength) + '…' : name}: ${pct.toFixed(1)}%`;

    return (
      <g>
        <polyline
          points={`${sx},${sy} ${elbowX},${labelY} ${lx},${labelY}`}
          stroke="#9ca3af"
          strokeWidth={1}
          fill="none"
        />
        <text
          x={lx + (isRight ? 4 : -4)}
          y={labelY}
          textAnchor={isRight ? 'start' : 'end'}
          dominantBaseline="central"
          fontSize={g.font}
          fontWeight={600}
          fill="#374151"
        >
          {label}
        </text>
      </g>
    );
  };
}

// Stable identities so recharts doesn't see a new label fn every render
const renderLabelFull = makeRenderLabel(FULL_GEOM);
const renderLabelCompact = makeRenderLabel(COMPACT_GEOM);
const renderLabelMobile = makeRenderLabel(MOBILE_GEOM);

export default function AllocationPie({ holdings, cashBalance, currency, defaultGroupMode = 'holding', title, compact = false }: AllocationPieProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('market_value');
  const [groupMode, setGroupMode] = useState<GroupMode>(defaultGroupMode);
  const [hoveredIndex, setHoveredIndex] = useState<number | undefined>(undefined);
  const isNarrow = useIsNarrow();
  const geom = compact ? COMPACT_GEOM : isNarrow ? MOBILE_GEOM : FULL_GEOM;

  const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
    { key: 'market_value', label: 'Market Value' },
    { key: 'cost', label: 'Cost' },
    { key: 'gain', label: 'Gain' },
    { key: 'loss', label: 'Loss' },
  ];

  function buildPieData(): PieDatum[] {
    let items: { name: string; value: number }[] = [];
    const effectiveGroupMode: GroupMode = compact ? 'holding' : groupMode;
    const effectiveViewMode: ViewMode = compact ? 'market_value' : viewMode;

    if (effectiveGroupMode === 'holding') {
      items = holdings.map(h => {
        let value: number;
        switch (effectiveViewMode) {
          case 'cost': value = h.cost_basis; break;
          case 'gain': value = Math.max(0, h.unrealised_gain); break;
          case 'loss': value = Math.abs(Math.min(0, h.unrealised_gain)); break;
          default: value = h.market_value;
        }
        // Display name only — strip the NSENG: routing prefix so NGX labels fit
        return { name: h.ticker.replace(/^NSENG:/, ''), value };
      });
    } else {
      const sectorMap = new Map<string, number>();
      for (const h of holdings) {
        const sector = normalizeSector(h);
        let value: number;
        switch (effectiveViewMode) {
          case 'cost': value = h.cost_basis; break;
          case 'gain': value = Math.max(0, h.unrealised_gain); break;
          case 'loss': value = Math.abs(Math.min(0, h.unrealised_gain)); break;
          default: value = h.market_value;
        }
        sectorMap.set(sector, (sectorMap.get(sector) || 0) + value);
      }
      items = Array.from(sectorMap.entries()).map(([name, value]) => ({ name, value }));
    }

    if (effectiveViewMode === 'market_value' && cashBalance > 0) {
      items.push({ name: 'Cash', value: cashBalance });
    }

    const total = items.reduce((s, x) => s + Math.max(0, x.value), 0);
    const data: PieDatum[] = items
      .filter(i => i.value > 0.01)
      .sort((a, b) => b.value - a.value)
      .map(i => ({ ...i, pct: total > 0 ? (i.value / total) * 100 : 0 }));

    layoutLabels(data, geom);
    return data;
  }

  // Memoise so hovering (which only flips `hoveredIndex`) doesn't hand Recharts
  // a fresh data array — a new reference makes it replay its entry animation,
  // flashing every slice label off and back on. Recompute only on real input
  // changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pieData = useMemo(() => buildPieData(), [holdings, viewMode, groupMode, cashBalance, compact, geom]);
  const totalValue = pieData.reduce((s, d) => s + d.value, 0);

  const hoveredItem = hoveredIndex != null ? pieData[hoveredIndex] : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-0 py-3 sm:p-5">
      {/* Title + group mode toggle */}
      {(title || !compact) && <div className="flex items-center justify-between mb-3">
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
      </div>}

      {pieData.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
          No allocation data for this view
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={geom.height}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                startAngle={90}
                endAngle={-270}
                innerRadius={geom.inner}
                outerRadius={geom.outer}
                paddingAngle={1.5}
                dataKey="value"
                nameKey="name"
                label={compact ? renderLabelCompact : isNarrow ? renderLabelMobile : renderLabelFull}
                labelLine={false}
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
              <Tooltip content={<CustomTooltip currency={currency} />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              {hoveredItem ? (
                <>
                  <p className={`text-xs text-gray-400 truncate ${compact ? 'max-w-[88px]' : 'max-w-[120px]'}`}>{hoveredItem.name}</p>
                  <p className={`${compact ? 'text-sm' : 'text-lg'} font-bold tabular-nums text-gray-900`}>{formatMoney(hoveredItem.value, currency)}</p>
                  <p className="text-xs tabular-nums text-gray-500">{hoveredItem.pct.toFixed(1)}%</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400 uppercase">Total</p>
                  <p className={`${compact ? 'text-sm' : 'text-lg'} font-bold tabular-nums text-gray-900`}>{formatMoney(totalValue, currency)}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* View mode toggles */}
      {!compact && (
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
      )}
    </div>
  );
}
