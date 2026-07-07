'use client';

import { useMemo, useState } from 'react';
import type { NgxSummary } from '@/lib/types';
import { useApi } from '@/lib/hooks';

// NGX prices are Naira. Round to whole Naira — kobo precision is noise at these
// price levels and NGX quotes are effectively whole-Naira anyway.
function formatNaira(value: number | null): string {
  if (value == null) return '-';
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | null): string {
  if (value == null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// Trailing returns are fractions (0.1 = +10%); render as whole-percent chips.
function formatRet(value: number | null): string {
  if (value == null) return '–';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function retColor(value: number | null): string {
  if (value == null) return 'text-gray-400';
  return value >= 0 ? 'text-green-600' : 'text-red-600';
}

// Short display name from "NSENG:MTNN" → "MTNN".
function symbolOf(ticker: string): string {
  return ticker.startsWith('NSENG:') ? ticker.slice('NSENG:'.length) : ticker;
}

// Compact ₦ market cap, e.g. 15746700000000 → "₦15.7T".
function formatCap(value: number | null): string | null {
  if (value == null) return null;
  if (value >= 1e12) return `₦${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `₦${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `₦${(value / 1e6).toFixed(1)}M`;
  return `₦${value.toFixed(0)}`;
}

function Metric({ label, value }: { label: string; value: string | null }) {
  if (value == null) return null;
  return (
    <span className="text-gray-500">
      {label} <b className="tabular-nums text-gray-700">{value}</b>
    </span>
  );
}

// One-decimal number, or null so the metric is skipped.
function num1(value: number | null): string | null {
  return value == null ? null : value.toFixed(1);
}
function pct1(value: number | null): string | null {
  return value == null ? null : `${value.toFixed(1)}%`;
}

function MomentumChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${retColor(value)}`}>{formatRet(value)}</span>
    </div>
  );
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function NgxCard({ s }: { s: NgxSummary }) {
  const [showNews, setShowNews] = useState(false);
  const isPositive = (s.change_pct ?? 0) >= 0;
  // Trend badge from the 50/200-day MA stack: a simple, benchmark-free read.
  const trend: { label: string; cls: string } | null =
    s.above_200d == null
      ? null
      : s.above_200d && (s.ext50 ?? 0) >= 0
        ? { label: 'Uptrend', cls: 'bg-green-100 text-green-700' }
        : !s.above_200d && (s.ext50 ?? 0) < 0
          ? { label: 'Downtrend', cls: 'bg-red-100 text-red-700' }
          : { label: 'Mixed', cls: 'bg-amber-100 text-amber-700' };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{symbolOf(s.ticker)}</h3>
            {trend && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${trend.cls}`}>
                {trend.label}
              </span>
            )}
          </div>
          {s.name && <p className="text-[11px] text-gray-400">{s.name}</p>}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-gray-900">{formatNaira(s.close)}</p>
          <p className={`text-xs font-medium tabular-nums ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {formatPct(s.change_pct)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1 border-t border-gray-100 pt-2.5">
        <MomentumChip label="5D" value={s.ret_5d} />
        <MomentumChip label="1M" value={s.ret_1m} />
        <MomentumChip label="3M" value={s.ret_3m} />
        <MomentumChip label="6M" value={s.ret_6m} />
        <MomentumChip label="1Y" value={s.ret_1y} />
      </div>

      {(s.pe != null || s.dividend_yield != null || s.market_cap != null) && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-2.5 text-[11px]">
          <Metric label="P/E" value={num1(s.pe)} />
          <Metric label="P/B" value={num1(s.pb)} />
          <Metric label="EPS" value={s.eps == null ? null : `₦${s.eps.toFixed(2)}`} />
          <Metric label="Yield" value={pct1(s.dividend_yield)} />
          <Metric label="Net mgn" value={pct1(s.net_margin)} />
          <Metric label="Cap" value={formatCap(s.market_cap)} />
        </div>
      )}

      {s.news.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2.5">
          <button
            onClick={() => setShowNews(v => !v)}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {showNews ? 'Hide' : 'Show'} {s.news.length} headline{s.news.length !== 1 ? 's' : ''}
          </button>
          {showNews && (
            <ul className="mt-2 space-y-1.5">
              {s.news.map(article => (
                <li key={article.url} className="text-xs">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {article.title}
                  </a>
                  <span className="text-gray-400 ml-1">
                    — {article.publisher}
                    {article.published_at ? ` · ${relativeDate(article.published_at)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(s.stale || s.warning) && (
        <p className="mt-2 text-[10px] text-gray-400">
          {s.warning ?? 'Price unavailable'}
        </p>
      )}
    </div>
  );
}

export default function NgxSummaries() {
  const { data: body, loading } = useApi<{ data: NgxSummary[] }>('/api/summaries/ngx');
  const summaries = useMemo(() => body?.data ?? [], [body]);

  // Hide the whole section when there are no NGX names — keeps the page clean
  // for anyone without a Nigerian portfolio.
  if (!loading && summaries.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-gray-900">NGX (Nigerian Exchange)</h2>
        <span className="text-[11px] text-gray-400">
          Price, momentum, valuation &amp; Nigerian-press headlines — no analyst ratings/targets exist for NGX
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-gray-200 h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {summaries.map(s => (
            <NgxCard key={s.ticker} s={s} />
          ))}
        </div>
      )}
    </section>
  );
}
