interface LoadingSkeletonProps {
  className?: string;
}

export default function LoadingSkeleton({ className = 'h-32' }: LoadingSkeletonProps) {
  return (
    <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <div className="flex gap-4">
          {[80, 120, 60, 60, 80, 80].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-gray-200" style={{ width: w }} />
          ))}
        </div>
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-gray-100">
          <div className="flex gap-4">
            {[80, 120, 60, 60, 80, 80].map((w, j) => (
              <div key={j} className="h-3 animate-pulse rounded bg-gray-100" style={{ width: w }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
        <div className="flex gap-1">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-6 w-16 animate-pulse rounded-md bg-gray-100" />
          ))}
        </div>
      </div>
      <div className="animate-pulse rounded bg-gray-100" style={{ height }} />
    </div>
  );
}
