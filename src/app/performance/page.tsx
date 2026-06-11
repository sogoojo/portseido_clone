'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import BenchmarkTable from '@/components/performance/BenchmarkTable';
import HistoricalReturnChart from '@/components/performance/HistoricalReturnChart';
import AccountSelector from '@/components/layout/AccountSelector';
import LoadingSkeleton, { TableSkeleton, ChartSkeleton } from '@/components/ui/LoadingSkeleton';
import { useApi } from '@/lib/hooks';

interface PeriodReturn {
  period: string;
  mwr?: number | null;
  return_pct?: number | null;
}

interface HistoricalReturn {
  period: string;
  return_pct: number | null;
}

interface PerformanceData {
  portfolio: PeriodReturn[];
  benchmarks: {
    sp500: PeriodReturn[];
    nasdaq: PeriodReturn[];
  };
  historical: HistoricalReturn[];
}

function PerformanceContent() {
  const searchParams = useSearchParams();
  const account = searchParams.get('account') || 'all';
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly' | 'annually'>('monthly');
  const { data: body, loading, error } = useApi<{ data: PerformanceData }>(
    `/api/performance?account=${account}&granularity=${granularity}`
  );
  const data = body?.data || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Performance</h1>
        <AccountSelector />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load performance data: {error}
        </div>
      )}

      {loading ? (
        <>
          <TableSkeleton rows={4} />
          <ChartSkeleton height={240} />
        </>
      ) : data ? (
        <>
          <BenchmarkTable
            portfolio={data.portfolio}
            sp500={data.benchmarks.sp500}
            nasdaq={data.benchmarks.nasdaq}
          />
          <HistoricalReturnChart
            data={data.historical}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />
        </>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">Need at least 1 month of data to show returns.</p>
          <a href="/transactions" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
            Add transactions to get started &rarr;
          </a>
        </div>
      )}
    </div>
  );
}

export default function PerformancePage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96" />}>
      <PerformanceContent />
    </Suspense>
  );
}
