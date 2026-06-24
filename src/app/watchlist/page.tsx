'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WatchlistRow, BuySignal, TrendState, ThesisState, PortfolioNote, NotePortfolio } from '@/lib/types';

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

type SortKey = 'distance' | 'pct_from_high' | 'ytd_change';
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null;

function SortableTh({ label, col, sort, onSort }: {
  label: string;
  col: SortKey;
  sort: SortState;
  onSort: (key: SortKey, dir: 'asc' | 'desc') => void;
}) {
  const active = sort?.key === col ? sort.dir : null;
  const arrowCls = (dir: 'asc' | 'desc') =>
    `block leading-none text-[9px] px-1 ${active === dir ? 'text-blue-600' : 'text-gray-300 hover:text-gray-600'}`;
  return (
    <th className="px-2 text-right font-medium"
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
      <span className="inline-flex items-center">
        <button type="button"
          onClick={() => onSort(col, active === 'desc' ? 'asc' : 'desc')}
          className={`uppercase tracking-wide hover:text-gray-700 ${active ? 'text-blue-600' : ''}`}
          title={`Sort by ${label}`}>
          {label}
        </button>
        <span className="inline-flex flex-col">
          <button type="button" onClick={() => onSort(col, 'asc')} className={arrowCls('asc')}
            title={`Sort ${label} ascending (worst first)`} aria-label={`Sort ${label} ascending`}>▲</button>
          <button type="button" onClick={() => onSort(col, 'desc')} className={arrowCls('desc')}
            title={`Sort ${label} descending (best first)`} aria-label={`Sort ${label} descending`}>▼</button>
        </span>
      </span>
    </th>
  );
}

function WatchlistTable({ rows, onRemove, onUpdateAnchor, variant = 'global' }: {
  rows: WatchlistRow[];
  onRemove: (ticker: string) => void;
  onUpdateAnchor: (ticker: string, value: number | null) => void;
  variant?: 'global' | 'ngx';
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sort, setSort] = useState<SortState>(null);

  // Clicking the active arrow again clears the sort (back to verdict order)
  const toggleSort = useCallback((key: SortKey, dir: 'asc' | 'desc') => {
    setSort(s => (s?.key === key && s.dir === dir ? null : { key, dir }));
  }, []);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last either direction
      if (bv == null) return -1;
      return dir === 'asc' ? av - bv : bv - av;
    });
  }, [rows, sort]);

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
            <SortableTh label="Distance" col="distance" sort={sort} onSort={toggleSort} />
            <th className="px-2 text-center font-medium">Trend</th>
            <SortableTh label="From 52w High" col="pct_from_high" sort={sort} onSort={toggleSort} />
            <SortableTh label="YTD" col="ytd_change" sort={sort} onSort={toggleSort} />
            {variant === 'global' && <th className="px-2 text-right font-medium">Analyst</th>}
            <th className="px-2 text-left font-medium">Notes</th>
            <th className="px-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(r => {
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
                <td className={`px-2 text-right tabular-nums font-medium ${r.ytd_change == null ? 'text-gray-400' : r.ytd_change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {signedPct(r.ytd_change)}
                </td>
                {variant === 'global' && (
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

// Reminder time helpers. <input type="datetime-local"> works in the user's local
// zone with no offset; we store ISO 8601 UTC, so convert at the boundary.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
function formatRemind(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
// Colour + suffix for a reminder chip: sent (grey), due-but-unsent (amber), or pending (grey).
function remindMeta(n: PortfolioNote): { cls: string; suffix: string } {
  if (n.notified_at) return { cls: 'text-gray-400', suffix: ' · sent' };
  const due = new Date(n.remind_at as string).getTime() <= Date.now();
  return due ? { cls: 'text-amber-600', suffix: ' · due' } : { cls: 'text-gray-500', suffix: '' };
}

/** Free-form action items / plans shown under each portfolio section. */
function NotesPanel({ portfolio, tickers }: { portfolio: NotePortfolio; tickers: string[] }) {
  const [notes, setNotes] = useState<PortfolioNote[]>([]);
  const [text, setText] = useState('');
  const [noteTicker, setNoteTicker] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editTicker, setEditTicker] = useState('');
  const [editRemind, setEditRemind] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null); // open item awaiting "mark done" confirmation

  const listId = `note-tickers-${portfolio}`;

  const load = useCallback(() => {
    fetch(`/api/notes?portfolio=${portfolio}`)
      .then(r => r.json())
      .then(j => setNotes(Array.isArray(j.data) ? j.data : []))
      .catch(() => {});
  }, [portfolio]);

  useEffect(() => { load(); }, [load]);

  const call = useCallback(async (method: string, body?: unknown, qs = '') => {
    setErr(null);
    const res = await fetch(`/api/notes${qs}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.message || `Request failed (${res.status})`);
    }
    return res.json();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await call('POST', {
        portfolio,
        text: text.trim(),
        ticker: noteTicker.trim() || null,
        remind_at: localInputToIso(remindAt),
      });
      setText(''); setNoteTicker(''); setRemindAt('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggle(n: PortfolioNote) {
    try { await call('PATCH', { id: n.id, done: !n.done }); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  async function remove(id: number) {
    try { await call('DELETE', undefined, `?id=${id}`); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  function startEdit(n: PortfolioNote) {
    setConfirmId(null);
    setEditId(n.id); setEditText(n.text); setEditTicker(n.ticker ?? ''); setEditRemind(isoToLocalInput(n.remind_at));
  }

  async function commitEdit() {
    if (editId == null) return;
    const id = editId;
    const trimmed = editText.trim();
    setEditId(null);
    if (!trimmed) return; // empty: abandon edit, keep original
    const orig = notes.find(n => n.id === id);
    const remindIso = localInputToIso(editRemind);
    const body: { id: number; text: string; ticker: string | null; remind_at?: string | null } =
      { id, text: trimmed, ticker: editTicker.trim() || null };
    // Only send remind_at when it actually changed — sending it re-arms a
    // delivered reminder (clears notified_at), so we avoid re-firing on a text edit.
    if (remindIso !== (orig?.remind_at ?? null)) body.remind_at = remindIso;
    try { await call('PATCH', body); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  const open = notes.filter(n => !n.done);
  const done = notes.filter(n => n.done);

  const renderNote = (n: PortfolioNote) => (
    <li key={n.id} className={`flex items-start gap-2 py-1 ${confirmId === n.id ? 'rounded bg-green-50/60' : ''}`}>
      <input
        type="checkbox"
        checked={n.done || confirmId === n.id}
        onChange={() => {
          if (n.done) toggle(n);                       // un-done: instant (reversible, low risk)
          else if (confirmId === n.id) setConfirmId(null); // click again = cancel
          else { setEditId(null); setConfirmId(n.id); }    // open → ask before completing
        }}
        className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-gray-900"
        aria-label={n.done ? `Mark "${n.text}" not done` : `Mark "${n.text}" done`}
      />
      {confirmId === n.id ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {n.ticker && (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{n.ticker}</span>
          )}
          <span className="text-sm text-gray-700">{n.text}</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-gray-500">Mark done?</span>
            <button onClick={() => { setConfirmId(null); toggle(n); }}
              className="rounded bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-green-700">Yes</button>
            <button onClick={() => setConfirmId(null)}
              className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">Cancel</button>
          </span>
        </div>
      ) : editId === n.id ? (
        <div
          className="flex flex-1 flex-wrap items-center gap-2"
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commitEdit(); }}
        >
          <input list={listId} value={editTicker} onChange={e => setEditTicker(e.target.value.toUpperCase())}
            placeholder="Ticker"
            className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-xs focus:border-blue-500 focus:outline-none" />
          <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') setEditId(null); }}
            className="flex-1 min-w-[160px] rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none" />
          <input type="datetime-local" value={editRemind} onChange={e => setEditRemind(e.target.value)}
            title="Reminder time (clear to remove)" aria-label="Reminder time"
            className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 focus:border-blue-500 focus:outline-none" />
        </div>
      ) : (
        <>
          <button onClick={() => startEdit(n)} className="flex flex-1 flex-col items-start gap-0.5 text-left" title="Click to edit">
            <span className="flex items-start gap-2">
              {n.ticker && (
                <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{n.ticker}</span>
              )}
              <span className={`text-sm ${n.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{n.text}</span>
            </span>
            {n.remind_at && !n.done && (() => {
              const meta = remindMeta(n);
              return (
                <span className={`flex items-center gap-1 text-[10px] ${meta.cls}`}>
                  🔔 {formatRemind(n.remind_at)}{meta.suffix}
                </span>
              );
            })()}
          </button>
          <button onClick={() => remove(n.id)} className="text-gray-300 hover:text-red-500" title="Delete" aria-label={`Delete note "${n.text}"`}>×</button>
        </>
      )}
    </li>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Action items &amp; plans</h3>
        {done.length > 0 && (
          <button onClick={() => setShowDone(s => !s)} className="text-[11px] text-gray-400 hover:text-gray-600">
            {showDone ? 'Hide' : 'Show'} completed ({done.length})
          </button>
        )}
      </div>

      <form onSubmit={add} className="mb-2 flex flex-wrap items-center gap-2">
        <input list={listId} value={noteTicker} onChange={e => setNoteTicker(e.target.value.toUpperCase())}
          placeholder="Ticker (optional)"
          className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none" />
        <datalist id={listId}>{tickers.map(t => <option key={t} value={t} />)}</datalist>
        <input value={text} onChange={e => setText(e.target.value)}
          placeholder="What do you plan to do? e.g. Close higher, recycle into META"
          className="flex-1 min-w-[200px] rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none" />
        <input type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)}
          title="Optional reminder — get a Telegram ping at this time" aria-label="Reminder time (optional)"
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 focus:border-blue-500 focus:outline-none" />
        <button type="submit" disabled={busy}
          className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>

      {err && <p className="mb-1 text-xs text-red-600">{err}</p>}

      {open.length === 0 && done.length === 0 ? (
        <p className="text-xs text-gray-400">No action items yet — jot down what you plan to do.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {open.map(renderNote)}
          {showDone && done.map(renderNote)}
        </ul>
      )}
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
              <NotesPanel portfolio="global" tickers={globalRows.map(r => r.ticker)} />
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
              <NotesPanel portfolio="ngx" tickers={ngxRows.map(r => r.ticker.replace(/^NSENG:/, ''))} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
