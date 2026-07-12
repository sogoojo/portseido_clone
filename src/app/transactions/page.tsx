'use client';

import { useState, useCallback, Suspense } from 'react';
import type { Transaction } from '@/lib/types';
import TransactionTable from '@/components/transactions/TransactionTable';
import TransactionForm from '@/components/transactions/TransactionForm';
import CsvImport from '@/components/transactions/CsvImport';
import AccountSelector from '@/components/layout/AccountSelector';
import { useAccounts } from '@/lib/hooks';

function TransactionsContent() {
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const accounts = useAccounts();

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  function handleEdit(transaction: Transaction) {
    setEditingTransaction(transaction);
    setShowForm(true);
  }

  async function handleDelete(id: number) {
    setDeleteError(null);
    try {
      const res = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        refresh();
      } else {
        const json = await res.json().catch(() => null);
        setDeleteError(json?.message || `Failed to delete transaction (${res.status})`);
      }
    } catch {
      setDeleteError('Network error while deleting transaction');
    }
  }

  function handleAdd() {
    setEditingTransaction(null);
    setShowForm(true);
  }

  function handleCloseForm() {
    setShowForm(false);
    setEditingTransaction(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <AccountSelector />
          <button
            onClick={handleAdd}
            className="min-h-10 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 sm:min-h-0"
          >
            Add Transaction
          </button>
        </div>
      </div>

      {deleteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      <CsvImport accounts={accounts} onImported={refresh} />

      <Suspense fallback={<div className="animate-pulse rounded-lg bg-gray-100 h-64" />}>
        <TransactionTable onEdit={handleEdit} onDelete={handleDelete} refreshKey={refreshKey} />
      </Suspense>

      {showForm && (
        <TransactionForm
          transaction={editingTransaction}
          onClose={handleCloseForm}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse rounded-lg bg-gray-100 h-96" />}>
      <TransactionsContent />
    </Suspense>
  );
}
