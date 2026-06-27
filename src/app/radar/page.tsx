'use client';

import { useApi } from '@/lib/hooks';
import type { ThemeRotation } from '@/lib/services/rotation';
import RotationHeatmap from '@/components/radar/RotationHeatmap';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

interface RotationData {
  themes: ThemeRotation[];
  asOf: string;
}

export default function RadarPage() {
  const { data, loading, error } = useApi<{ data: RotationData }>('/api/rotation');
  const payload = data?.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Radar</h2>
        <p className="mt-1 text-sm text-gray-500">
          Where the market is moving, and how stretched your own positions are — so you catch a
          running sector even when nobody&apos;s pointing it out.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load radar: {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <LoadingSkeleton className="h-96" />
          <LoadingSkeleton className="h-72" />
        </div>
      ) : payload ? (
        <>
          <RotationHeatmap themes={payload.themes} />
          <p className="text-xs text-gray-400">
            Built from daily closes. Relative strength is measured vs the S&amp;P 500. Not investment
            advice.
          </p>
        </>
      ) : null}
    </div>
  );
}
