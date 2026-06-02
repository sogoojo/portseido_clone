'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import type { Transaction, Account } from '@/lib/types';
import TransactionTable from '@/components/transactions/TransactionTable';
import TransactionForm from '@/components/transactions/TransactionForm';
import CsvImport from '@/components/transactions/CsvImport';
import AccountSelector from '@/components/layout/AccountSelector';

function TransactionsContent() {
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setAccounts(json.data);
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  function handleEdit(transaction: Transaction) {
    setEditingTransaction(transaction);
    setShowForm(true);
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
      if (res.ok) refresh();
    } catch {
      // silent
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        <div className="flex items-center gap-3">
          <AccountSelector />
          <button
            onClick={handleAdd}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add Transaction
          </button>
        </div>
      </div>

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
