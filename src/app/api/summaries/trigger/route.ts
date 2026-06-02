import { NextResponse } from 'next/server';
import { runDailySummaries } from '@/lib/services/summaries';

export const maxDuration = 120;

export async function POST() {
  try {
    const result = await runDailySummaries();
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[API/summaries/trigger] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
