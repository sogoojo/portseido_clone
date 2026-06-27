import { NextRequest, NextResponse } from 'next/server';
import { evaluateTheses, evaluateThesis, upsertThesis, deleteThesis } from '@/lib/services/theses';
import type { ThesisRole, ThesisTrigger } from '@/lib/types';

const ROLES: ThesisRole[] = ['compounder', 'trade', 'speculative'];

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (ticker) {
      return NextResponse.json({ data: await evaluateThesis(ticker.toUpperCase()) });
    }
    return NextResponse.json({ data: await evaluateTheses() });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const ticker = (body.ticker || '').trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: 'validation', message: 'ticker is required' }, { status: 400 });
    }
    if (body.role != null && !ROLES.includes(body.role)) {
      return NextResponse.json(
        { error: 'validation', message: `role must be one of: ${ROLES.join(', ')}` },
        { status: 400 }
      );
    }
    if (body.triggers != null && !Array.isArray(body.triggers)) {
      return NextResponse.json({ error: 'validation', message: 'triggers must be an array' }, { status: 400 });
    }
    const saved = upsertThesis({
      ticker,
      role: body.role ?? null,
      thesis: typeof body.thesis === 'string' ? body.thesis : null,
      target_weight: typeof body.target_weight === 'number' ? body.target_weight : null,
      triggers: (body.triggers as ThesisTrigger[]) ?? [],
    });
    // Return the evaluated form so the UI reflects fired states immediately.
    return NextResponse.json({ data: await evaluateThesis(saved.ticker) });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) {
      return NextResponse.json({ error: 'validation', message: 'ticker query param is required' }, { status: 400 });
    }
    deleteThesis(ticker.toUpperCase());
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
