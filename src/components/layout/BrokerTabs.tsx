'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Account } from '@/lib/types';

export default function BrokerTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);

  const selected = searchParams.get('account') || 'all';

  useEffect(() => {
    fetch('/api/accounts')
      .then((res) => res.json())
      .then((json) => { if (json.data) setAccounts(json.data); })
      .catch(() => {});
  }, []);

  function handleSelect(accountId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('account', accountId);
    router.push(`${pathname}?${params.toString()}`);
  }

  const tabs = [
    { id: 'all', label: 'Home' },
    ...accounts.map(a => ({ id: a.id, label: a.name })),
  ];

  return (
    <div className="border-b border-gray-200">
      <div className="flex gap-0 overflow-x-auto">
        {tabs.map(tab => {
          const isActive = selected === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleSelect(tab.id)}
              className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
