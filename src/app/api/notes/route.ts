import { NextRequest, NextResponse } from 'next/server';
import { listNotes, addNote, updateNote, deleteNote } from '@/lib/services/notes';
import type { NotePortfolio, TriggerDirection } from '@/lib/types';

const PORTFOLIOS: NotePortfolio[] = ['global', 'ngx'];
const isPortfolio = (v: unknown): v is NotePortfolio =>
  typeof v === 'string' && (PORTFOLIOS as string[]).includes(v);

// Normalise a client-supplied reminder time to ISO 8601 UTC (or null to clear).
// Returns { ok: false } for an unparseable value so the route can 400.
function normalizeRemindAt(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = Date.parse(v);
  if (Number.isNaN(t)) return { ok: false };
  return { ok: true, value: new Date(t).toISOString() };
}

// Price trigger level: a positive finite number, or null/'' to clear.
function normalizeTriggerPrice(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

function normalizeTriggerDirection(v: unknown): { ok: true; value: TriggerDirection | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (v === 'above' || v === 'below') return { ok: true, value: v };
  return { ok: false };
}

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
    const { portfolio, text, ticker, remind_at, trigger_price, trigger_direction } = await request.json();
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
    const remind = normalizeRemindAt(remind_at);
    if (!remind.ok) {
      return NextResponse.json({ error: 'validation', message: 'remind_at must be a valid date' }, { status: 400 });
    }
    const trigger = normalizeTriggerPrice(trigger_price);
    if (!trigger.ok) {
      return NextResponse.json({ error: 'validation', message: 'trigger_price must be a positive number' }, { status: 400 });
    }
    const direction = normalizeTriggerDirection(trigger_direction);
    if (!direction.ok) {
      return NextResponse.json({ error: 'validation', message: "trigger_direction must be 'above' or 'below'" }, { status: 400 });
    }
    const tickerVal = typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : null;
    if (trigger.value != null && !tickerVal) {
      return NextResponse.json({ error: 'validation', message: 'a price alert needs a ticker' }, { status: 400 });
    }
    return NextResponse.json({ data: addNote(portfolio, trimmed, tickerVal, remind.value, trigger.value, direction.value) });
  } catch (err) {
    console.error('[API/notes] Error:', err);
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, text, done, ticker, remind_at, trigger_price, trigger_direction } = await request.json();
    if (typeof id !== 'number') {
      return NextResponse.json({ error: 'validation', message: 'id is required' }, { status: 400 });
    }
    const fields: {
      text?: string;
      done?: boolean;
      ticker?: string | null;
      remind_at?: string | null;
      trigger_price?: number | null;
      trigger_direction?: TriggerDirection | null;
    } = {};
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
    if (remind_at !== undefined) {
      const remind = normalizeRemindAt(remind_at);
      if (!remind.ok) {
        return NextResponse.json({ error: 'validation', message: 'remind_at must be a valid date' }, { status: 400 });
      }
      fields.remind_at = remind.value;
    }
    if (trigger_price !== undefined) {
      const trigger = normalizeTriggerPrice(trigger_price);
      if (!trigger.ok) {
        return NextResponse.json({ error: 'validation', message: 'trigger_price must be a positive number' }, { status: 400 });
      }
      fields.trigger_price = trigger.value;
    }
    if (trigger_direction !== undefined) {
      const direction = normalizeTriggerDirection(trigger_direction);
      if (!direction.ok) {
        return NextResponse.json({ error: 'validation', message: "trigger_direction must be 'above' or 'below'" }, { status: 400 });
      }
      fields.trigger_direction = direction.value;
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
