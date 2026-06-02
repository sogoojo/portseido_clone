'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PortfolioSummary from '@/components/dashboard/PortfolioSummary';
import InfoTabs from '@/components/dashboard/InfoTabs';
import CounterfactualCard from '@/components/dashboard/CounterfactualCard';
import AccountCards from '@/components/dashboard/AccountCards';
import ValueChart from '@/components/dashboard/ValueChart';
import BrokerTabs from '@/components/layout/BrokerTabs';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

function DashboardContent() {
  const searchParams = useSearchParams();
  const account = searchParams.get('account') || 'all';
  const isAggregate = account === 'all';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [portfolio, setPortfolio] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portfolio?account=${account}`)
      .then(r => r.json())
      .then(json => { if (json.data) setPortfolio(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [account]);

  const allTimePnl = portfolio?.all_time_pnl;
  const allTimeGain = allTimePnl?.total ?? 0;
  const allTimeGainPct = allTimePnl?.total_pct ?? 0;
  const totalDeposited = portfolio?.total_deposited ?? 0;
  const displayCurrency = isAggregate ? 'USD' : portfolio?.currency || 'USD';

  return (
    <div className="space-y-6">
      {/* Broker Tabs */}
      <BrokerTabs />

      {/* Empty state */}
      {!loading && portfolio && (portfolio.holdings || []).length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500 mb-2">No transactions yet.</p>
          <a href="/transactions" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
            Import your broker CSV or add transactions manually &rarr;
          </a>
        </div>
      )}

      {/* Two-column summary: Left = Portfolio Summary, Right = Info Tabs */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <LoadingSkeleton className="h-52 lg:col-span-2" />
          <LoadingSkeleton className="h-52 lg:col-span-3" />
        </div>
      ) : portfolio ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <PortfolioSummary
              isAggregate={isAggregate}
              totalValueEur={portfolio.total_eur}
              totalValueUsd={portfolio.total_usd}
              value={portfolio.value}
              currency={portfolio.currency}
              todayPnL={portfolio.pnl?.today || { amount: 0, pct: 0 }}
              allTimeGain={allTimeGain}
              allTimeGainPct={allTimeGainPct}
              totalDeposited={totalDeposited}
            />
          </div>
          <div className="lg:col-span-3">
            <InfoTabs
              account={account}
              allTimePnl={allTimePnl}
              currency={displayCurrency}
            />
          </div>
        </div>
      ) : null}

      {/* Value Chart */}
      <ValueChart />

      {/* Counterfactual */}
      <CounterfactualCard />

      {/* Account cards (aggregate only) */}
      {isAggregate && portfolio?.accounts && (
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Accounts</h3>
          <AccountCards accounts={portfolio.accounts} />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96" />}>
      <DashboardContent />
    </Suspense>
  );
}
