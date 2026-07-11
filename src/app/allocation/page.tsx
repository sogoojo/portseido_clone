'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import AllocationPie, { formatMoney } from '@/components/allocation/AllocationPie';
import AllocationStats from '@/components/allocation/AllocationStats';
import HoldingsTable from '@/components/allocation/HoldingsTable';
import BrokerTabs from '@/components/layout/BrokerTabs';
import LoadingSkeleton, { ChartSkeleton, TableSkeleton } from '@/components/ui/LoadingSkeleton';
import type { PortfolioHolding } from '@/lib/types';
import type { NgxBrokerBreakdown } from '@/lib/services/portfolio';

interface PortfolioData {
  holdings: PortfolioHolding[];
  total_usd?: number;
  accounts?: Array<{ cash: number; cash_usd: number; value_usd: number }>;
  value?: number;
  cash?: number;
  currency?: string;
}

function AllocationContent() {
  const searchParams = useSearchParams();
  const account = searchParams.get('account') || 'all';
  const { data: body, loading, error } = useApi<{ data: PortfolioData }>(`/api/portfolio?account=${account}`);
  const {
    data: brokerBody,
    loading: brokersLoading,
    error: brokersError,
  } = useApi<{ data: NgxBrokerBreakdown[] }>(account === 'ngx' ? '/api/portfolio/ngx-brokers' : null);
  const data = body?.data || null;
  const brokerBreakdowns = brokerBody?.data || [];

  const holdings = data?.holdings || [];

  let cashBalance = 0;
  let totalValue = 0;
  let displayCurrency = 'USD';

  if (data) {
    if (data.accounts) {
      // Per-account cash is in the account's own currency — sum the USD values
      cashBalance = data.accounts.reduce((s, a) => s + (a.cash_usd || 0), 0);
      totalValue = data.total_usd || 0;
      displayCurrency = 'USD';
    } else {
      cashBalance = data.cash || 0;
      totalValue = data.value || 0;
      displayCurrency = data.currency || 'USD';
    }
  }

  return (
    <div className="space-y-6">
      {/* Broker Tabs */}
      <BrokerTabs />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load allocation: {error}
        </div>
      )}

      {loading ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartSkeleton height={280} />
            <ChartSkeleton height={280} />
          </div>
          <LoadingSkeleton className="h-20" />
          <TableSkeleton rows={6} />
        </>
      ) : holdings.length === 0 && cashBalance <= 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">No holdings found.</p>
          <a href="/transactions" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
            Add buy transactions to see your allocation &rarr;
          </a>
        </div>
      ) : (
        <>
          {/* Two donut charts side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AllocationPie holdings={holdings} cashBalance={cashBalance} currency={displayCurrency} defaultGroupMode="holding" title="By Holding" />
            <AllocationPie holdings={holdings} cashBalance={cashBalance} currency={displayCurrency} defaultGroupMode="sector" title="By Sector" />
          </div>

          {account === 'ngx' && brokersLoading && (
            <section className="space-y-3">
              <h3 className="text-base font-semibold text-gray-900">By Broker</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ChartSkeleton height={260} />
                <ChartSkeleton height={260} />
              </div>
            </section>
          )}

          {account === 'ngx' && brokersError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Failed to load broker allocation: {brokersError}
            </div>
          )}

          {account === 'ngx' && !brokersLoading && !brokersError && brokerBreakdowns.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-base font-semibold text-gray-900">By Broker</h3>
              <div className={`grid grid-cols-1 gap-4 ${brokerBreakdowns.length > 2 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                {brokerBreakdowns.map(breakdown => (
                  <div key={breakdown.broker} className="space-y-2">
                    <AllocationPie
                      holdings={breakdown.holdings}
                      cashBalance={0}
                      currency="NGN"
                      defaultGroupMode="holding"
                      title={breakdown.broker}
                      compact
                    />
                    <p className="text-center text-sm tabular-nums text-gray-500">
                      {formatMoney(breakdown.total_value, 'NGN')} · {breakdown.holdings.length} holdings
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Stats row */}
          <AllocationStats
            totalValue={totalValue}
            holdingsCount={holdings.length}
            cashBalance={cashBalance}
            currency={displayCurrency}
          />

          {/* Holdings table */}
          <HoldingsTable
            holdings={holdings}
            currency={displayCurrency}
          />
        </>
      )}
    </div>
  );
}

export default function AllocationPage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96" />}>
      <AllocationContent />
    </Suspense>
  );
}
