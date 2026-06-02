import { NextRequest, NextResponse } from 'next/server';
import { getMultipleCurrentPrices } from '@/lib/services/prices';

export async function GET(request: NextRequest) {
  const tickersParam = request.nextUrl.searchParams.get('tickers');

  if (!tickersParam) {
    return NextResponse.json(
      { error: 'validation', message: 'Missing required query param: tickers (comma-separated)' },
      { status: 400 }
    );
  }

  const tickers = tickersParam.split(',').map(t => t.trim()).filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json(
      { error: 'validation', message: 'No valid tickers provided' },
      { status: 400 }
    );
  }

  try {
    const results = await getMultipleCurrentPrices(tickers);
    return NextResponse.json({ data: results });
  } catch (err) {
    console.error('[API/prices] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
