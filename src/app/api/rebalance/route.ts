import { NextRequest, NextResponse } from 'next/server';
import { computeRebalance, upsertTarget, deleteTarget } from '@/lib/services/targets';

export async function GET() {
  try {
    const result = await computeRebalance();
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[API/rebalance] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { ticker, tier, target_pct } = await request.json();
    if (!ticker || typeof ticker !== 'string' || typeof target_pct !== 'number') {
      return NextResponse.json(
        { error: 'validation', message: 'ticker and numeric target_pct are required' },
        { status: 400 }
      );
    }
    upsertTarget(ticker.toUpperCase(), tier ?? null, target_pct);
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    console.error('[API/rebalance] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) {
      return NextResponse.json({ error: 'validation', message: 'ticker query param is required' }, { status: 400 });
    }
    deleteTarget(ticker.toUpperCase());
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[API/rebalance] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
