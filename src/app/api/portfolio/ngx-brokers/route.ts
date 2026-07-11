import { NextResponse } from 'next/server';
import { getNgxBrokerHoldings } from '@/lib/services/portfolio';

export async function GET() {
  try {
    const data = await getNgxBrokerHoldings();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[API/portfolio/ngx-brokers] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
