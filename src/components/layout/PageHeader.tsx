import { Suspense } from 'react';
import AccountSelector from './AccountSelector';

interface PageHeaderProps {
  title: string;
}

export default function PageHeader({ title }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <Suspense fallback={<div className="h-10 w-full animate-pulse rounded-md bg-gray-100 sm:h-9 sm:w-48" />}>
        <AccountSelector />
      </Suspense>
    </div>
  );
}
