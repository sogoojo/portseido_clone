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
    if (!Number.isFinite(target_pct) || target_pct < 0 || target_pct > 100) {
      return NextResponse.json(
        { error: 'validation', message: 'target_pct must be between 0 and 100' },
        { status: 400 }
      );
    }
    if (tier != null && (!Number.isInteger(tier) || tier < 1 || tier > 3)) {
      return NextResponse.json(
        { error: 'validation', message: 'tier must be 1, 2 or 3' },
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
