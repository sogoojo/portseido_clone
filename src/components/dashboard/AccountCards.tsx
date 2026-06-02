'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

interface AccountCardData {
  account_id: string;
  name: string;
  currency: string;
  value: number;
  value_eur: number;
  value_usd: number;
}

interface AccountCardsProps {
  accounts: AccountCardData[];
}

function formatMoney(value: number, currency: string): string {
  const sym = currency === 'EUR' ? '\u20ac' : currency === 'NGN' ? '\u20a6' : '$';
  const sign = value >= 0 ? '' : '-';
  const abs = Math.abs(value);
  return `${sign}${sym}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccountCards({ accounts }: AccountCardsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleClick(accountId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('account', accountId);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (accounts.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {accounts.map((a) => (
        <button
          key={a.account_id}
          onClick={() => handleClick(a.account_id)}
          className="flex-shrink-0 rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-gray-400 hover:shadow-sm transition-all min-w-[180px]"
        >
          <p className="text-sm font-medium text-gray-900">{a.name}</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900 mt-1">
            {formatMoney(a.value, a.currency)}
          </p>
          <p className="text-xs tabular-nums text-gray-400">
            {formatMoney(a.value_usd, 'USD')}
          </p>
        </button>
      ))}
    </div>
  );
}
