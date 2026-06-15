import { NextResponse } from 'next/server';
import { getKnownTickers } from '@/lib/services/tickers';

export async function GET() {
  try {
    return NextResponse.json({ data: getKnownTickers() });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
