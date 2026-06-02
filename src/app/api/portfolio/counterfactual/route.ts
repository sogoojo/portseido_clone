import { NextRequest, NextResponse } from 'next/server';
import { calculateCounterfactual } from '@/lib/services/benchmark';

export async function GET(request: NextRequest) {
  const account = request.nextUrl.searchParams.get('account') || 'all';

  try {
    const result = await calculateCounterfactual(account === 'all' ? undefined : account);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[API/portfolio/counterfactual] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
