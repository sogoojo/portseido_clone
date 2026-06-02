import { Suspense } from 'react';
import AccountSelector from './AccountSelector';

interface PageHeaderProps {
  title: string;
}

export default function PageHeader({ title }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <Suspense fallback={<div className="h-9 w-48 animate-pulse rounded-md bg-gray-100" />}>
        <AccountSelector />
      </Suspense>
    </div>
  );
}
