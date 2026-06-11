'use client';

import { useState, useEffect, useCallback } from 'react';
import type { WatchlistRow, BuySignal, TrendState, ThesisState } from '@/lib/types';

const SIGNAL_STYLE: Record<BuySignal, { text: string; chip: string; row: string }> = {
  strong_buy: { text: '🔥 Strong Buy', chip: 'bg-green-100 text-green-700', row: 'bg-green-50/60' },
  buy: { text: '✅ Buy', chip: 'bg-green-50 text-green-700', row: 'bg-green-50/30' },
  watch: { text: '👀 Watch', chip: 'bg-amber-100 text-amber-700', row: '' },
  avoid: { text: '⛔ Avoid', chip: 'bg-red-100 text-red-700', row: 'bg-red-50/40' },
  hold: { text: '💤 Hold', chip: 'bg-gray-100 text-gray-500', row: '' },
  none: { text: 'Set target', chip: 'bg-gray-100 text-gray-400', row: '' },
};

const TREND_ICON: Record<TrendState, string> = {
  uptrend: '↗', downtrend: '↘', neutral: '→', unknown: '·',
};
const THESIS_ICON: Record<ThesisState, { icon: string; cls: string; title: string }> = {
  improving: { icon: 'est ↑', cls: 'text-green-600', title: 'Estimates being raised' },
  stable: { icon: 'est →', cls: 'text-gray-400', title: 'Estimates stable' },
  weakening: { icon: 'est ↓', cls: 'text-red-600', title: 'Estimates being cut' },
  unknown: { icon: '', cls: 'text-gray-300', title: 'No estimate data' },
};

const money = (v: number | null, ccy = 'USD') =>
  v == null ? '–' : `${ccy === 'EUR' ? '€' : ccy === 'NGN' ? '₦' : '$'}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedPct = (v: number | null) =>
  v == null ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

function WatchlistTable({ rows, onRemove, onUpdateAnchor, variant = 'global' }: {
  rows: WatchlistRow[];
  onRemove: (ticker: string) => void;
  onUpdateAnchor: (ticker: string, value: number | null) => void;
  variant?: 'global' | 'ngx';
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(r: WatchlistRow) {
    setEditing(r.ticker);
    setDraft(r.target_entry != null ? String(r.target_entry) : '');
  }

  function commitEdit(ticker: string) {
    if (editing !== ticker) return;
    setEditing(null);
    const trimmed = draft.trim();
    const value = trimmed === '' ? null : parseFloat(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return; // invalid input: ignore
    const current = rows.find(r => r.ticker === ticker)?.target_entry ?? null;
    if (value === current) return; // nothing changed
    onUpdateAnchor(ticker, value);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
            <th className="py-2 pl-3 pr-2 text-left font-medium">Signal</th>
            <th className="px-2 text-left font-medium">Ticker</th>
            <th className="px-2 text-right font-medium">Price</th>
            <th className="px-2 text-right font-medium">Fair entry</th>
            <th className="px-2 text-right font-medium">Anchor</th>
            <th className="px-2 text-right font-medium">Distance</th>
            <th className="px-2 text-center font-medium">Trend</th>
            <th className="px-2 text-right font-medium">From 52w High</th>
            <th className="px-2 text-right font-medium">{variant === 'ngx' ? 'YTD' : 'Analyst'}</th>
            <th className="px-2 text-left font-medium">Notes</th>
            <th className="px-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const sig = SIGNAL_STYLE[r.signal];
            const displayTicker = r.ticker.replace(/^NSENG:/, '');
            return (
              <tr key={r.ticker} className={`border-b border-gray-100 ${sig.row}`}>
                <td className="py-2 pl-3 pr-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sig.chip}`}>{sig.text}</span>
                </td>
                <td className="px-2 font-medium text-gray-900" title={r.name || undefined}>{displayTicker}</td>
                <td className="px-2 text-right tabular-nums text-gray-700">{money(r.price, r.currency)}</td>
                <td className="px-2 text-right tabular-nums text-gray-700">
                  {money(r.effective_target, r.currency)}
                  {r.target_basis === 'fixed' && <span className="ml-1 text-[9px] text-amber-500" title="No dynamic inputs — using your manual anchor">fix</span>}
                </td>
                <td className="px-2 text-right tabular-nums text-gray-400">
                  {editing === r.ticker ? (
                    <input
                      autoFocus
                      type="number"
                      step="any"
                      min="0"
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(r.ticker);
                        else if (e.key === 'Escape') setEditing(null);
                      }}
                      onBlur={() => commitEdit(r.ticker)}
                      className="w-24 rounded border border-blue-400 px-1.5 py-0.5 text-right text-sm tabular-nums focus:outline-none"
                      aria-label={`Anchor price for ${r.ticker}`}
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(r)}
                      className="rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-600"
                      title="Click to edit anchor (empty = clear)"
                    >
                      {money(r.target_entry, r.currency)}
                    </button>
                  )}
                </td>
                <td className={`px-2 text-right tabular-nums font-medium ${r.distance == null ? 'text-gray-400' : r.distance >= 0 ? 'text-green-600' : 'text-gray-500'}`}>
                  {signedPct(r.distance)}
                </td>
                <td className="px-2 text-center">
                  <span className={r.trend === 'downtrend' ? 'text-red-500' : r.trend === 'uptrend' ? 'text-green-600' : 'text-gray-400'}
                    title={`Trend: ${r.trend}`}>{TREND_ICON[r.trend]}</span>
                  {r.knife && <span title="Falling knife: downtrend + near 52w low"> 🔪</span>}
                </td>
                <td className={`px-2 text-right tabular-nums ${r.pct_from_high == null ? 'text-gray-400' : r.pct_from_high < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {signedPct(r.pct_from_high)}
                </td>
                {variant === 'ngx' ? (
                  <td className={`px-2 text-right tabular-nums font-medium ${r.ytd_change == null ? 'text-gray-400' : r.ytd_change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {signedPct(r.ytd_change)}
                  </td>
                ) : (
                  <td className="px-2 text-right text-[11px] text-gray-500">
                    {r.recommendation_key ? r.recommendation_key.replace('_', ' ') : ''}
                    {r.analyst_upside != null && (
                      <span className={r.analyst_upside >= 0 ? 'text-green-600' : 'text-red-600'}> {signedPct(r.analyst_upside)}</span>
                    )}
                    {r.thesis !== 'unknown' && (
                      <span className={`ml-1 ${THESIS_ICON[r.thesis].cls}`} title={THESIS_ICON[r.thesis].title}>{THESIS_ICON[r.thesis].icon}</span>
                    )}
                  </td>
                )}
                <td className="px-2 text-[11px] text-gray-400 max-w-[180px] truncate">{r.notes}</td>
                <td className="px-2 pr-3 text-right">
                  <button onClick={() => onRemove(r.ticker)} className="text-gray-300 hover:text-red-500" title="Remove" aria-label={`Remove ${displayTicker} from watchlist`}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function WatchlistPage() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState('');
  const [target, setTarget] = useState('');
  const [tier, setTier] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(j => setRows(Array.isArray(j.data) ? j.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          target_entry: target ? parseFloat(target) : null,
          tier: tier ? parseInt(tier) : null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || `Failed to add (${res.status})`);
      }
      setTicker(''); setTarget(''); setTier(''); setNotes('');
      load();
    } catch (err) {
      setActionError((err as Error).message || 'Failed to add ticker');
    } finally {
      setSaving(false);
    }
  }

  const ngxRows = rows.filter(r => r.ticker.startsWith('NSENG:'));
  const globalRows = rows.filter(r => !r.ticker.startsWith('NSENG:'));

  async function updateAnchor(t: string, value: number | null) {
    setActionError(null);
    try {
      const res = await fetch('/api/watchlist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, target_entry: value }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || `Failed to update anchor (${res.status})`);
      }
      load();
    } catch (err) {
      setActionError((err as Error).message || 'Failed to update anchor');
    }
  }

  async function remove(t: string) {
    setActionError(null);
    try {
      const res = await fetch(`/api/watchlist?ticker=${encodeURIComponent(t)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || `Failed to remove (${res.status})`);
      }
      load();
    } catch (err) {
      setActionError((err as Error).message || 'Failed to remove ticker');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Watchlist</h1>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="Ticker (NGX: NSENG:UBA)"
          className="w-44 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Target entry $" type="number" step="any"
          className="w-32 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        <select value={tier} onChange={e => setTier(e.target.value)}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-600 focus:border-blue-500 focus:outline-none">
          <option value="">Tier…</option>
          <option value="1">1 · Stability</option>
          <option value="2">2 · Growth</option>
          <option value="3">3 · Speculative</option>
        </select>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes"
          className="flex-1 min-w-[140px] rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        <button type="submit" disabled={saving}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? 'Adding…' : 'Add / Update'}
        </button>
      </form>

      {actionError && (
        <p className="text-sm text-red-600">{actionError}</p>
      )}

      <p className="text-xs text-gray-500 max-w-2xl">
        Verdict starts from cheapness vs a <b>dynamic fair entry</b> (avg of 200-day MA − 5% and
        analyst target − 20%), then adjusts for trend &amp; thesis: a <b>falling knife</b> (downtrend
        + near 52-week low, marked 🔪) caps a buy to 👀 <b>Watch</b>, and if estimates are also being
        cut it becomes ⛔ <b>Avoid</b>. Trend ↗/↘ is the 50/200-day MA stack; <b>est ↑/↓</b> is
        whether analysts are raising or cutting next-year EPS.
      </p>

      {loading ? (
        <div className="animate-pulse rounded-lg bg-gray-200 h-48" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Watchlist is empty — add a ticker above.</p>
      ) : (
        <>
          {globalRows.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Global</h2>
              <WatchlistTable rows={globalRows} onRemove={remove} onUpdateAnchor={updateAnchor} />
            </section>
          )}
          {ngxRows.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">🇳🇬 Nigeria (NGX)</h2>
              <WatchlistTable rows={ngxRows} onRemove={remove} onUpdateAnchor={updateAnchor} variant="ngx" />
              <p className="text-[11px] text-gray-400">
                NGX signals use TradingView candle history (50/200-day MAs, 52-week range) — no analyst
                coverage exists, so fair entry is the 200-day MA − 5% unless you set an anchor.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
