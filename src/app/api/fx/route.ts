import { NextRequest, NextResponse } from 'next/server';
import { getRate } from '@/lib/services/fx';

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json(
      { error: 'validation', message: 'Missing required query params: from, to' },
      { status: 400 }
    );
  }

  try {
    const result = await getRate(from, to);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[API/fx] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
