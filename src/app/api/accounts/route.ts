import { NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Account } from '@/lib/types';

export async function GET() {
  try {
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY name').all() as Account[];
    return NextResponse.json({ data: accounts });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
