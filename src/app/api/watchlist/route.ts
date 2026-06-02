import { NextRequest, NextResponse } from 'next/server';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '@/lib/services/summaries';

export async function GET() {
  try {
    const items = getWatchlist();
    return NextResponse.json({ data: items });
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
    const { ticker, name } = body;

    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json(
        { error: 'validation', message: 'ticker is required' },
        { status: 400 }
      );
    }

    const item = addToWatchlist(ticker.toUpperCase(), name);
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
