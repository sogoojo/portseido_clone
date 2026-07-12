'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccounts, useTickers } from '@/lib/hooks';
import TickerCombobox from './TickerCombobox';
import type { Transaction, TransactionType, ThesisEvaluated } from '@/lib/types';

interface TransactionFormProps {
  transaction?: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: TransactionType[] = ['buy', 'sell', 'deposit', 'withdrawal', 'dividend'];

export default function TransactionForm({ transaction, onClose, onSaved }: TransactionFormProps) {
  const searchParams = useSearchParams();
  const globalAccount = searchParams.get('account') || 'all';
  const isEdit = !!transaction;

  const accounts = useAccounts();
  const tickers = useTickers();
  const [type, setType] = useState<TransactionType>(transaction?.type || 'buy');
  const [accountId, setAccountId] = useState(transaction?.account_id || (globalAccount !== 'all' ? globalAccount : ''));
  const [date, setDate] = useState(transaction?.date || new Date().toISOString().split('T')[0]);
  const [ticker, setTicker] = useState(transaction?.ticker || '');
  const [quantity, setQuantity] = useState(transaction?.quantity?.toString() || '');
  const [pricePerUnit, setPricePerUnit] = useState(transaction?.price_per_unit?.toString() || '');
  const [amount, setAmount] = useState(transaction?.amount?.toString() || '');
  const [currency, setCurrency] = useState(transaction?.currency || '');
  const [commission, setCommission] = useState(transaction?.commission?.toString() || '0');
  const [notes, setNotes] = useState(transaction?.notes || '');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Sell-discipline gate: if you're selling a name with a written thesis and no
  // trigger has fired, make you confirm you're acting against your own rule.
  const [sellThesis, setSellThesis] = useState<ThesisEvaluated | null>(null);
  const [ackSell, setAckSell] = useState(false);

  useEffect(() => {
    setAckSell(false);
    if (type !== 'sell' || !ticker) {
      setSellThesis(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/theses?ticker=${encodeURIComponent(ticker.toUpperCase())}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setSellThesis((j?.data as ThesisEvaluated) ?? null);
      })
      .catch(() => {
        if (!cancelled) setSellThesis(null);
      });
    return () => {
      cancelled = true;
    };
  }, [type, ticker]);

  const sellAgainstThesis = type === 'sell' && !!sellThesis && sellThesis.firedCount === 0;

  // Auto-fill currency from the pre-selected account once accounts load
  useEffect(() => {
    if (!currency && accountId && accounts.length > 0) {
      const acct = accounts.find((a) => a.id === accountId);
      if (acct) setCurrency(acct.currency);
    }
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Currency follows the selected account (switching Degiro→Trading212
  // should flip EUR→USD, not keep the old currency)
  function handleAccountChange(id: string) {
    setAccountId(id);
    const acct = accounts.find((a) => a.id === id);
    if (acct) setCurrency(acct.currency);
  }

  const needsTicker = type === 'buy' || type === 'sell' || type === 'dividend';
  const needsQuantityPrice = type === 'buy' || type === 'sell';
  const needsAmount = type === 'deposit' || type === 'withdrawal' || type === 'dividend';

  function validate(): string[] {
    const errs: string[] = [];
    if (!accountId) errs.push('Account is required');
    if (!date) errs.push('Date is required');
    if (!currency) errs.push('Currency is required');
    if (needsTicker && !ticker) errs.push('Ticker is required');
    if (needsQuantityPrice) {
      if (!quantity || parseFloat(quantity) <= 0) errs.push('Quantity must be > 0');
      if (!pricePerUnit || parseFloat(pricePerUnit) <= 0) errs.push('Price must be > 0');
    }
    if (needsAmount && (!amount || parseFloat(amount) <= 0)) errs.push('Amount must be > 0');
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    if (sellAgainstThesis && !ackSell) {
      setErrors(['This sells against your thesis — no sell trigger has fired. Confirm below to proceed.']);
      return;
    }
    setErrors([]);
    setSubmitting(true);

    const body: Record<string, unknown> = {
      account_id: accountId,
      date,
      type,
      ticker: needsTicker ? ticker.toUpperCase() : null,
      quantity: needsQuantityPrice ? parseFloat(quantity) : null,
      price_per_unit: needsQuantityPrice ? parseFloat(pricePerUnit) : null,
      amount: needsAmount ? parseFloat(amount) : needsQuantityPrice ? parseFloat(quantity) * parseFloat(pricePerUnit) : null,
      currency,
      commission: parseFloat(commission) || 0,
      notes: notes || null,
    };

    if (isEdit) body.id = transaction!.id;

    try {
      const res = await fetch('/api/transactions', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const json = await res.json();
        setErrors([json.message || 'Failed to save']);
      }
    } catch {
      setErrors(['Network error']);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit Transaction' : 'Add Transaction'}
        className="mx-4 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:mx-0 sm:rounded-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit Transaction' : 'Add Transaction'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="flex min-h-10 min-w-10 items-center justify-center text-xl leading-none text-gray-400 hover:text-gray-600 sm:min-h-0 sm:min-w-0">
            &times;
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`min-h-10 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors sm:min-h-0 sm:py-1.5 ${
                    type === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Account + Date row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
              <select
                value={accountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">Select account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
              />
            </div>
          </div>

          {/* Ticker */}
          {needsTicker && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ticker</label>
              <TickerCombobox
                value={ticker}
                onChange={setTicker}
                options={tickers}
                preferCurrency={currency}
                placeholder="Search e.g. AAPL, BTC-USD, NSENG:MTNN"
              />
            </div>
          )}

          {/* Quantity + Price */}
          {needsQuantityPrice && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-base tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price per unit</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-base tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>
          )}

          {/* Amount */}
          {needsAmount && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
              />
            </div>
          )}

          {/* Currency + Commission row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">Select</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="NGN">NGN</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Commission</label>
              <input
                type="number"
                step="any"
                min="0"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-base tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
            />
          </div>

          {/* Sell-discipline gate */}
          {type === 'sell' && sellThesis && (
            <div
              className={`rounded-md border p-3 text-xs ${
                sellThesis.firedCount > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <p className="font-semibold">
                {ticker.toUpperCase()} has a thesis — {sellThesis.firedCount} of {sellThesis.triggerCount} sell
                trigger{sellThesis.triggerCount !== 1 ? 's' : ''} fired.
              </p>
              {sellThesis.firedCount > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {sellThesis.evaluated
                    .filter((t) => t.fired)
                    .map((t) => (
                      <li key={t.id}>
                        {t.text}
                        {t.detail ? ` · ${t.detail}` : ''}
                      </li>
                    ))}
                </ul>
              ) : (
                <>
                  <p className="mt-1">
                    None of your pre-committed triggers have fired — the trend/fundamentals still
                    back the thesis. Selling now is a discretionary call, not a rule.
                  </p>
                  <label className="mt-2 flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={ackSell} onChange={(e) => setAckSell(e.target.checked)} />
                    I&apos;m selling against my thesis anyway
                  </label>
                </>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-10 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:min-h-0"
            >
              {submitting ? 'Saving...' : isEdit ? 'Update' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
