'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useAccounts } from '@/lib/hooks';

export default function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const accounts = useAccounts();

  const selected = searchParams.get('account') || 'all';

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set('account', value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={selected}
      onChange={handleChange}
      className="min-h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:min-h-0 sm:w-auto sm:py-1.5 sm:text-sm"
    >
      <option value="all">All Accounts</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.currency})
        </option>
      ))}
    </select>
  );
}
