import { NextRequest, NextResponse } from 'next/server';
import { addToWatchlist, removeFromWatchlist, updateWatchlistTarget } from '@/lib/services/summaries';
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

/** Set or clear (null) a ticker's anchor price. */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, target_entry } = body;

    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json(
        { error: 'validation', message: 'ticker is required' },
        { status: 400 }
      );
    }
    if (target_entry !== null && (typeof target_entry !== 'number' || !Number.isFinite(target_entry) || target_entry < 0)) {
      return NextResponse.json(
        { error: 'validation', message: 'target_entry must be a non-negative number or null' },
        { status: 400 }
      );
    }

    const item = updateWatchlistTarget(ticker.toUpperCase(), target_entry);
    if (!item) {
      return NextResponse.json(
        { error: 'not_found', message: `${ticker} is not on the watchlist` },
        { status: 404 }
      );
    }
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
