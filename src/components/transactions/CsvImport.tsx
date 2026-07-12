'use client';

import { useState, useRef } from 'react';
import { parseCsv } from '@/lib/services/import';
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
    // Quote-aware parse — a naive split(',') shifts every column after a
    // value like "Apple, Inc." or "1,234.56"
    const records = parseCsv(text);
    if (records.length < 2) return { headers: [], rows: [] };

    const hdrs = records[0];
    const rows = records.slice(1).map((vals) => {
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
      // Always send the raw CSV — the server parsers handle quoting,
      // thousands separators, date normalisation and sign conventions in
      // one place instead of a divergent client-side re-implementation
      const body = { account_id: accountId, broker, csv_content: rawCsv };

      const res = await fetch('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        const skipped = json.data.skipped > 0 ? `, skipped ${json.data.skipped} duplicate${json.data.skipped === 1 ? '' : 's'}` : '';
        setResult(`Imported ${json.data.imported} transactions${skipped}`);
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
        className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:min-h-0"
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
          className="min-h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:min-h-0 sm:w-auto sm:text-sm"
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
          className="min-h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:min-h-0 sm:w-auto sm:text-sm"
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
          className="w-full max-w-full text-base text-gray-600 file:mr-3 file:min-h-10 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50 sm:w-auto sm:text-sm sm:file:min-h-0"
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
