import { NextRequest, NextResponse } from 'next/server';
import { addToWatchlist, removeFromWatchlist } from '@/lib/services/summaries';
import { getWatchlistRows } from '@/lib/services/watchlist';

export async function GET() {
  try {
    const rows = await getWatchlistRows();
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[API/watchlist] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, name, target_entry, tier, notes } = body;

    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json(
        { error: 'validation', message: 'ticker is required' },
        { status: 400 }
      );
    }

    const item = addToWatchlist(ticker.toUpperCase(), name, {
      target_entry: typeof target_entry === 'number' ? target_entry : null,
      tier: typeof tier === 'number' ? tier : null,
      notes: typeof notes === 'string' ? notes : null,
    });
    return NextResponse.json({ data: item });
  } catch (err) {
    console.error('[API/watchlist] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) {
      return NextResponse.json(
        { error: 'validation', message: 'ticker query param is required' },
        { status: 400 }
      );
    }

    removeFromWatchlist(ticker.toUpperCase());
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[API/watchlist] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
