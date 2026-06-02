'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Transaction, TransactionType } from '@/lib/types';

interface TransactionRow extends Transaction {
  account_name: string;
}

interface TransactionTableProps {
  onEdit: (transaction: TransactionRow) => void;
  onDelete: (id: number) => void;
  refreshKey: number;
}

const TYPE_COLORS: Record<TransactionType, string> = {
  buy: 'bg-green-100 text-green-800',
  sell: 'bg-red-100 text-red-800',
  deposit: 'bg-blue-100 text-blue-800',
  withdrawal: 'bg-orange-100 text-orange-800',
  dividend: 'bg-purple-100 text-purple-800',
};

const SORTABLE_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Action' },
  { key: 'ticker', label: 'Ticker' },
  { key: 'price_per_unit', label: 'Price' },
  { key: 'quantity', label: 'Shares' },
  { key: 'amount', label: 'Amount' },
  { key: 'commission', label: 'Commission' },
  { key: 'account_id', label: 'Account' },
] as const;

const ALL_TYPES: TransactionType[] = ['buy', 'sell', 'deposit', 'withdrawal', 'dividend'];

export default function TransactionTable({ onEdit, onDelete, refreshKey }: TransactionTableProps) {
  const searchParams = useSearchParams();
  const globalAccount = searchParams.get('account') || 'all';

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterTypes, setFilterTypes] = useState<TransactionType[]>([]);
  const [filterTicker, setFilterTicker] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (globalAccount !== 'all') params.set('account_id', globalAccount);
    if (filterTypes.length > 0) params.set('type', filterTypes.join(','));
    if (filterTicker) params.set('ticker', filterTicker);
    if (filterDateFrom) params.set('date_from', filterDateFrom);
    if (filterDateTo) params.set('date_to', filterDateTo);
    params.set('page', String(page));
    params.set('limit', String(limit));
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);

    try {
      const res = await fetch(`/api/transactions?${params.toString()}`);
      const json = await res.json();
      if (json.data) {
        setTransactions(json.data);
        setTotal(json.total);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [globalAccount, filterTypes, filterTicker, filterDateFrom, filterDateTo, page, limit, sortBy, sortDir]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions, refreshKey]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [globalAccount, filterTypes, filterTicker, filterDateFrom, filterDateTo]);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  function toggleType(t: TransactionType) {
    setFilterTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function handleDeleteClick(id: number) {
    if (deleteConfirm === id) {
      onDelete(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function handleExportCsv() {
    if (transactions.length === 0) return;
    const headers = ['Date', 'Type', 'Ticker', 'Price', 'Shares', 'Amount', 'Commission', 'Account', 'Currency', 'Notes'];
    const rows = transactions.map(t => [
      t.date,
      t.type,
      t.ticker || '',
      t.price_per_unit != null ? t.price_per_unit.toFixed(2) : '',
      t.quantity != null ? t.quantity.toString() : '',
      t.amount != null ? t.amount.toFixed(2) : '',
      t.commission > 0 ? t.commission.toFixed(2) : '0',
      t.account_name || t.account_id,
      t.currency,
      t.notes || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portseido-lite-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap gap-1">
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                filterTypes.includes(t) ? TYPE_COLORS[t] : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search ticker..."
          value={filterTicker}
          onChange={(e) => setFilterTicker(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <span className="text-gray-400 text-sm">to</span>
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {(filterTypes.length > 0 || filterTicker || filterDateFrom || filterDateTo) && (
          <button
            onClick={() => {
              setFilterTypes([]);
              setFilterTicker('');
              setFilterDateFrom('');
              setFilterDateTo('');
            }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto">
          <button
            onClick={handleExportCsv}
            disabled={transactions.length === 0}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {SORTABLE_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
                >
                  {col.label}
                  {sortBy === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Currency
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                  <div className="space-y-2">
                    <p className="text-lg">No transactions found</p>
                    <p className="text-sm">Add a transaction or import from CSV to get started.</p>
                  </div>
                </td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-900">
                    {t.date}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${TYPE_COLORS[t.type]}`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {t.ticker || '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-700">
                    {t.price_per_unit != null ? t.price_per_unit.toFixed(2) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-700">
                    {t.quantity != null ? t.quantity.toFixed(4) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums font-medium text-gray-900">
                    {t.amount != null ? t.amount.toFixed(2) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-500">
                    {t.commission > 0 ? t.commission.toFixed(2) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {t.account_name || t.account_id}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {t.currency}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    <button
                      onClick={() => onEdit(t)}
                      className="text-blue-600 hover:text-blue-800 mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteClick(t.id)}
                      className={deleteConfirm === t.id ? 'text-red-700 font-semibold' : 'text-red-500 hover:text-red-700'}
                    >
                      {deleteConfirm === t.id ? 'Confirm?' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="flex items-center px-2">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
