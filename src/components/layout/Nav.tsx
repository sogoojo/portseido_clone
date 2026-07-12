'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { name: 'Dashboard', href: '/' },
  { name: 'Radar', href: '/radar' },
  { name: 'Performance', href: '/performance' },
  { name: 'Allocation', href: '/allocation' },
  { name: 'Rebalance', href: '/rebalance' },
  { name: 'Watchlist', href: '/watchlist' },
  { name: 'Transactions', href: '/transactions' },
  { name: 'Summaries', href: '/summaries' },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {tabs.map((tab) => {
        const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={onNavigate}
            className={`flex min-h-10 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors lg:min-h-0 ${
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
  );
}

export default function Nav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <>
      <aside className="hidden w-52 shrink-0 border-r border-gray-200 bg-white min-h-screen lg:block">
        <div className="px-5 py-5">
          <Link href="/" className="text-lg font-semibold text-gray-900">
            Portseido Lite
          </Link>
        </div>
        <NavLinks pathname={pathname} />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
        <Link href="/" className="text-base font-semibold text-gray-900">
          Portseido Lite
        </Link>
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          onClick={() => setDrawerOpen(true)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-2xl leading-none text-gray-700 hover:bg-gray-100"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40"
            onClick={closeDrawer}
          />
          <aside
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative flex h-full w-64 flex-col bg-white shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
              <Link href="/" onClick={closeDrawer} className="text-base font-semibold text-gray-900">
                Portseido Lite
              </Link>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={closeDrawer}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="overflow-y-auto py-3">
              <NavLinks pathname={pathname} onNavigate={closeDrawer} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
