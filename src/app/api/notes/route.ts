import { NextRequest, NextResponse } from 'next/server';
import { listNotes, addNote, updateNote, deleteNote } from '@/lib/services/notes';
import type { NotePortfolio } from '@/lib/types';

const PORTFOLIOS: NotePortfolio[] = ['global', 'ngx'];
const isPortfolio = (v: unknown): v is NotePortfolio =>
  typeof v === 'string' && (PORTFOLIOS as string[]).includes(v);

export async function GET(request: NextRequest) {
  try {
    const portfolio = request.nextUrl.searchParams.get('portfolio');
    if (!isPortfolio(portfolio)) {
      return NextResponse.json(
        { error: 'validation', message: "portfolio query param must be 'global' or 'ngx'" },
        { status: 400 }
      );
    }
    return NextResponse.json({ data: listNotes(portfolio) });
  } catch (err) {
    console.error('[API/notes] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { portfolio, text, ticker } = await request.json();
    if (!isPortfolio(portfolio)) {
      return NextResponse.json(
        { error: 'validation', message: "portfolio must be 'global' or 'ngx'" },
        { status: 400 }
      );
    }
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'validation', message: 'text is required' }, { status: 400 });
    }
    const tickerVal = typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : null;
    return NextResponse.json({ data: addNote(portfolio, trimmed, tickerVal) });
  } catch (err) {
    console.error('[API/notes] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, text, done, ticker } = await request.json();
    if (typeof id !== 'number') {
      return NextResponse.json({ error: 'validation', message: 'id is required' }, { status: 400 });
    }
    const fields: { text?: string; done?: boolean; ticker?: string | null } = {};
    if (text !== undefined) {
      const trimmed = typeof text === 'string' ? text.trim() : '';
      if (!trimmed) {
        return NextResponse.json({ error: 'validation', message: 'text cannot be empty' }, { status: 400 });
      }
      fields.text = trimmed;
    }
    if (done !== undefined) {
      if (typeof done !== 'boolean') {
        return NextResponse.json({ error: 'validation', message: 'done must be a boolean' }, { status: 400 });
      }
      fields.done = done;
    }
    if (ticker !== undefined) {
      fields.ticker = typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : null;
    }
    const note = updateNote(id, fields);
    if (!note) {
      return NextResponse.json({ error: 'not_found', message: `note ${id} not found` }, { status: 404 });
    }
    return NextResponse.json({ data: note });
  } catch (err) {
    console.error('[API/notes] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const idParam = request.nextUrl.searchParams.get('id');
    const id = idParam ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: 'validation', message: 'id query param is required' }, { status: 400 });
    }
    const deleted = deleteNote(id);
    if (!deleted) {
      return NextResponse.json({ error: 'not_found', message: `note ${id} not found` }, { status: 404 });
    }
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[API/notes] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
