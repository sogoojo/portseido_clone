import { NextRequest, NextResponse } from 'next/server';
import { searchTickers } from '@/lib/services/tickers';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ data: await searchTickers(q) });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
