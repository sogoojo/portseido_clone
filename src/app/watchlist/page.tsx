'use client';

import { useState, useEffect, useCallback } from 'react';
import type { WatchlistRow, BuySignal } from '@/lib/types';

const SIGNAL_STYLE: Record<BuySignal, { text: string; chip: string; row: string }> = {
  strong_buy: { text: '🔥 Strong Buy', chip: 'bg-green-100 text-green-700', row: 'bg-green-50/60' },
  buy: { text: '✅ Buy', chip: 'bg-green-50 text-green-700', row: 'bg-green-50/30' },
  watch: { text: '👀 Watch', chip: 'bg-amber-100 text-amber-700', row: '' },
  hold: { text: '💤 Hold', chip: 'bg-gray-100 text-gray-500', row: '' },
  none: { text: 'Set target', chip: 'bg-gray-100 text-gray-400', row: '' },
};

const money = (v: number | null, ccy = 'USD') =>
  v == null ? '–' : `${ccy === 'EUR' ? '€' : ccy === 'NGN' ? '₦' : '$'}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedPct = (v: number | null) =>
  v == null ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export default function WatchlistPage() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState('');
  const [target, setTarget] = useState('');
  const [tier, setTier] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: ticker.trim().toUpperCase(),
        target_entry: target ? parseFloat(target) : null,
        tier: tier ? parseInt(tier) : null,
        notes: notes.trim() || null,
      }),
    });
    setTicker(''); setTarget(''); setTier(''); setNotes('');
    setSaving(false);
    load();
  }

  async function remove(t: string) {
    await fetch(`/api/watchlist?ticker=${encodeURIComponent(t)}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Watchlist</h1>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="Ticker"
          className="w-28 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
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

      <p className="text-xs text-gray-500 max-w-2xl">
        Signal is driven by how far the live price sits below your <b>target entry</b>:
        at/below = 🔥 Strong Buy, within 5% = ✅ Buy, within 15% = 👀 Watch. 🔪 = falling knife (&gt;30% off 52w high).
      </p>

      {loading ? (
        <div className="animate-pulse rounded-lg bg-gray-200 h-48" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Watchlist is empty — add a ticker above.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-2 pl-3 pr-2 text-left font-medium">Signal</th>
                <th className="px-2 text-left font-medium">Ticker</th>
                <th className="px-2 text-right font-medium">Price</th>
                <th className="px-2 text-right font-medium">Target</th>
                <th className="px-2 text-right font-medium">Distance</th>
                <th className="px-2 text-right font-medium">From 52w High</th>
                <th className="px-2 text-right font-medium">Analyst</th>
                <th className="px-2 text-left font-medium">Notes</th>
                <th className="px-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const sig = SIGNAL_STYLE[r.signal];
                return (
                  <tr key={r.ticker} className={`border-b border-gray-100 ${sig.row}`}>
                    <td className="py-2 pl-3 pr-2">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sig.chip}`}>{sig.text}</span>
                    </td>
                    <td className="px-2 font-medium text-gray-900">{r.ticker}</td>
                    <td className="px-2 text-right tabular-nums text-gray-700">{money(r.price, r.currency)}</td>
                    <td className="px-2 text-right tabular-nums text-gray-500">{money(r.target_entry, r.currency)}</td>
                    <td className={`px-2 text-right tabular-nums font-medium ${r.distance == null ? 'text-gray-400' : r.distance >= 0 ? 'text-green-600' : 'text-gray-500'}`}>
                      {signedPct(r.distance)}
                    </td>
                    <td className="px-2 text-right tabular-nums text-gray-500">
                      {signedPct(r.pct_from_high)} {r.knife && <span title="Falling knife: >30% off 52w high">🔪</span>}
                    </td>
                    <td className="px-2 text-right text-[11px] text-gray-500">
                      {r.recommendation_key ? r.recommendation_key.replace('_', ' ') : ''}
                      {r.analyst_upside != null && (
                        <span className={r.analyst_upside >= 0 ? 'text-green-600' : 'text-red-600'}> {signedPct(r.analyst_upside)}</span>
                      )}
                    </td>
                    <td className="px-2 text-[11px] text-gray-400 max-w-[180px] truncate">{r.notes}</td>
                    <td className="px-2 pr-3 text-right">
                      <button onClick={() => remove(r.ticker)} className="text-gray-300 hover:text-red-500" title="Remove">×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
