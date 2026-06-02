'use client';

import { useState, useRef } from 'react';
import type { Account } from '@/lib/types';

interface CsvImportProps {
  accounts: Account[];
  onImported: () => void;
}

interface PreviewRow {
  [key: string]: string;
}

const BROKERS = [
  { key: 'generic', label: 'Generic CSV' },
  { key: 'degiro', label: 'Degiro' },
];

export default function CsvImport({ accounts, onImported }: CsvImportProps) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [broker, setBroker] = useState('generic');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<PreviewRow[]>([]);
  const [rawCsv, setRawCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function parseCsvPreview(text: string): { headers: string[]; rows: PreviewRow[] } {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };

    const hdrs = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map((line) => {
      const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
      const row: PreviewRow = {};
      hdrs.forEach((h, i) => {
        if (h) row[h] = vals[i] || '';
      });
      return row;
    });
    return { headers: hdrs.filter(Boolean), rows };
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawCsv(text);
      const { headers: hdrs, rows } = parseCsvPreview(text);
      setHeaders(hdrs);
      setAllRows(rows);
      setPreview(rows.slice(0, 10));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!accountId) {
      setResult('Please select an account');
      return;
    }
    if (allRows.length === 0) {
      setResult('No data to import');
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      let body: Record<string, unknown>;

      if (broker !== 'generic') {
        // Send raw CSV to server for broker-specific parsing
        body = { account_id: accountId, broker, csv_content: rawCsv };
      } else {
        // Generic: map CSV rows client-side
        const transactions = allRows.map((row) => {
          const get = (keys: string[]): string => {
            for (const k of keys) {
              const match = Object.keys(row).find((h) => h.toLowerCase() === k.toLowerCase());
              if (match && row[match]) return row[match];
            }
            return '';
          };

          return {
            date: get(['date', 'Date', 'trade_date', 'Trade Date']),
            type: get(['type', 'action', 'Action', 'Type', 'side', 'Side']).toLowerCase(),
            ticker: get(['ticker', 'symbol', 'Ticker', 'Symbol', 'ISIN', 'isin']),
            quantity: parseFloat(get(['quantity', 'shares', 'Quantity', 'Shares', 'qty', 'Qty'])) || null,
            price_per_unit: parseFloat(get(['price', 'price_per_unit', 'Price', 'Price per unit', 'unit_price'])) || null,
            amount: parseFloat(get(['amount', 'total', 'Amount', 'Total', 'value', 'Value'])) || null,
            currency: get(['currency', 'Currency', 'ccy']),
            commission: parseFloat(get(['commission', 'fee', 'Commission', 'Fee', 'fees', 'Fees'])) || 0,
            notes: get(['notes', 'Notes', 'description', 'Description']),
          };
        }).filter((t) => t.date);

        body = { account_id: accountId, transactions };
      }

      const res = await fetch('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(`Imported ${json.data.imported} transactions`);
        setAllRows([]);
        setPreview([]);
        setHeaders([]);
        setRawCsv('');
        if (fileRef.current) fileRef.current.value = '';
        onImported();
      } else {
        setResult(json.message || 'Import failed');
      }
    } catch {
      setResult('Network error');
    } finally {
      setImporting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Import CSV
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Import CSV</h3>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={broker}
          onChange={(e) => setBroker(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {BROKERS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="text-sm text-gray-600 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50"
        />
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {headers.map((h, i) => (
                  <th key={`${h}-${i}`} className="px-3 py-2 text-left font-medium text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.map((row, i) => (
                <tr key={i}>
                  {headers.map((h, j) => (
                    <td key={`${h}-${j}`} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                      {row[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {allRows.length > 10 && (
            <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
              Showing 10 of {allRows.length} rows
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`text-sm ${result.startsWith('Imported') ? 'text-green-700' : 'text-red-700'}`}>
          {result}
        </div>
      )}

      {preview.length > 0 && (
        <button
          onClick={handleImport}
          disabled={importing}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {importing ? 'Importing...' : `Import ${allRows.length} rows`}
        </button>
      )}
    </div>
  );
}
