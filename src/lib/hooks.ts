'use client';

import { useEffect, useState } from 'react';
import type { Account } from '@/lib/types';

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a JSON API endpoint and track loading/error state.
 *
 * - Aborts in-flight requests when the URL changes, so a slow response for a
 *   previously selected account can never overwrite the current one.
 * - On error the data is cleared (not left showing the previous URL's data).
 * - `debounceMs` delays the request — for type-ahead filters.
 *
 * Returns the parsed response body; most endpoints wrap payloads as { data }.
 */
export function useApi<T>(url: string | null, debounceMs = 0): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, loading: !!url, error: null });

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      setState(s => ({ ...s, loading: true, error: null }));
      fetch(url, { signal: controller.signal })
        .then(async res => {
          const json = await res.json();
          if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
          return json as T;
        })
        .then(json => setState({ data: json, loading: false, error: null }))
        .catch((err: Error) => {
          if (controller.signal.aborted) return;
          setState({ data: null, loading: false, error: err.message || 'Request failed' });
        });
    };

    if (debounceMs > 0) {
      timer = setTimeout(run, debounceMs);
    } else {
      run();
    }

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url, debounceMs]);

  return state;
}

// --- Accounts (fetched by several components; cache once per session) ---

let accountsCache: Account[] | null = null;
let accountsPromise: Promise<Account[]> | null = null;

function fetchAccounts(): Promise<Account[]> {
  if (accountsCache) return Promise.resolve(accountsCache);
  if (!accountsPromise) {
    accountsPromise = fetch('/api/accounts')
      .then(r => r.json())
      .then(json => {
        accountsCache = (json.data || []) as Account[];
        return accountsCache;
      })
      .catch(() => {
        accountsPromise = null; // allow retry on next mount
        return [] as Account[];
      });
  }
  return accountsPromise;
}

export function useAccounts(): Account[] {
  const [accounts, setAccounts] = useState<Account[]>(accountsCache || []);

  useEffect(() => {
    let mounted = true;
    fetchAccounts().then(a => {
      if (mounted) setAccounts(a);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return accounts;
}
