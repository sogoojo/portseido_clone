'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { name: 'Dashboard', href: '/' },
  { name: 'Performance', href: '/performance' },
  { name: 'Allocation', href: '/allocation' },
  { name: 'Transactions', href: '/transactions' },
  { name: 'Summaries', href: '/summaries' },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 border-r border-gray-200 bg-white min-h-screen">
      <div className="px-5 py-5">
        <Link href="/" className="text-lg font-semibold text-gray-900">
          Portseido Lite
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {tabs.map((tab) => {
          const isActive =
            tab.href === '/'
              ? pathname === '/'
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
