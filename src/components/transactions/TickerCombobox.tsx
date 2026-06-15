'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { TickerOption } from '@/lib/types';

interface TickerComboboxProps {
  value: string;
  onChange: (ticker: string) => void;
  options: TickerOption[];
  /** When set, tickers in this currency are surfaced first (the account's currency). */
  preferCurrency?: string;
  placeholder?: string;
}

const MAX_RESULTS = 50;

// Filter by ticker or company name, then rank: exact > prefix > substring >
// name-only, with held positions and preferred-currency tickers nudged up.
function rank(options: TickerOption[], q: string, preferCurrency?: string): TickerOption[] {
  const matches = q
    ? options.filter((o) => o.ticker.includes(q) || (o.name?.toUpperCase().includes(q) ?? false))
    : options.slice();

  const score = (o: TickerOption): number => {
    let s = 0;
    if (q) {
      if (o.ticker === q) s += 1000;
      else if (o.ticker.startsWith(q)) s += 100;
      else if (o.ticker.includes(q)) s += 50;
      else s += 10; // name-only match
    }
    if (o.held) s += 5;
    if (preferCurrency && o.currency === preferCurrency) s += 3;
    return s;
  };

  return matches.sort((a, b) => {
    const d = score(b) - score(a);
    return d !== 0 ? d : a.ticker.localeCompare(b.ticker);
  });
}

export default function TickerCombobox({ value, onChange, options, preferCurrency, placeholder }: TickerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const q = value.trim().toUpperCase();
  const filtered = rank(options, q, preferCurrency).slice(0, MAX_RESULTS);
  const exactMatch = q !== '' && options.some((o) => o.ticker === q);
  const showAddNew = q !== '' && !exactMatch;
  // Filtering can shrink the list past the highlighted index; clamp at use.
  const activeIndex = Math.min(highlight, Math.max(filtered.length - 1, 0));

  // Close the dropdown when clicking outside (but keep the typed value).
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function choose(ticker: string) {
    onChange(ticker);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // Close the dropdown first; don't let the modal's Escape handler fire.
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault();
        choose(filtered[activeIndex].ticker);
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {open && (filtered.length > 0 || showAddNew) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.map((opt, i) => (
            <li
              key={opt.ticker}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus; fire before blur/outside-click
                choose(opt.ticker);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${
                i === activeIndex ? 'bg-blue-50' : ''
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-gray-900">{opt.ticker}</span>
                {opt.name && <span className="truncate text-gray-500">{opt.name}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {opt.held && (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">held</span>
                )}
                {opt.currency && <span className="text-xs text-gray-400">{opt.currency}</span>}
              </span>
            </li>
          ))}
          {showAddNew && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(q);
              }}
              className="cursor-pointer border-t border-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Use new ticker &ldquo;<span className="font-medium text-gray-900">{q}</span>&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
