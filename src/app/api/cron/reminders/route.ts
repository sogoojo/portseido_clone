import { NextRequest, NextResponse } from 'next/server';
import { runReminders } from '@/lib/services/reminders';

export const maxDuration = 60;

// Triggered hourly by .github/workflows/reminders.yml — scans due action-item
// reminders and delivers them over Telegram. Guarded by the same x-cron-secret
// as the daily-summaries cron.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Invalid or missing x-cron-secret header' },
      { status: 401 }
    );
  }

  try {
    const result = await runReminders();
    // Telegram configured but every delivery failed => real outage; 502 so the
    // GitHub Action goes red. Missing config is a one-time setup gap, not an
    // outage, so don't fail CI on it (the items stay pending and surface in-app).
    if (result.configured && result.due > 0 && result.sent === 0) {
      return NextResponse.json(
        { error: 'delivery_failed', message: `0/${result.due} reminders delivered`, data: result },
        { status: 502 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[Cron/reminders] Error:', err);
    return NextResponse.json(
      { error: 'server', message: (err as Error).message },
      { status: 500 }
    );
  }
}
