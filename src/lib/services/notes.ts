import db from '@/lib/db';
import type { NotePortfolio, PortfolioNote, TriggerDirection } from '@/lib/types';

// SQLite stores `done` as INTEGER 0/1 — normalise to boolean at the boundary.
interface NoteRow {
  id: number;
  portfolio: string;
  ticker: string | null;
  text: string;
  done: number;
  remind_at: string | null;
  trigger_price: number | null;
  trigger_direction: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

function toNote(r: NoteRow): PortfolioNote {
  return {
    id: r.id,
    portfolio: r.portfolio as NotePortfolio,
    ticker: r.ticker,
    text: r.text,
    done: r.done === 1,
    remind_at: r.remind_at,
    trigger_price: r.trigger_price,
    trigger_direction: r.trigger_direction as TriggerDirection | null,
    notified_at: r.notified_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Open items first, then by creation order so a list reads like a plan top-down. */
export function listNotes(portfolio: NotePortfolio): PortfolioNote[] {
  const rows = db
    .prepare('SELECT * FROM portfolio_notes WHERE portfolio = ? ORDER BY done ASC, created_at ASC, id ASC')
    .all(portfolio) as NoteRow[];
  return rows.map(toNote);
}

export function addNote(
  portfolio: NotePortfolio,
  text: string,
  ticker?: string | null,
  remindAt?: string | null,
  triggerPrice?: number | null,
  triggerDirection?: TriggerDirection | null
): PortfolioNote {
  const result = db
    .prepare(
      'INSERT INTO portfolio_notes (portfolio, ticker, text, remind_at, trigger_price, trigger_direction) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(portfolio, ticker ?? null, text, remindAt ?? null, triggerPrice ?? null, triggerPrice != null ? triggerDirection ?? 'above' : null);
  const row = db
    .prepare('SELECT * FROM portfolio_notes WHERE id = ?')
    .get(result.lastInsertRowid) as NoteRow;
  return toNote(row);
}

export function updateNote(
  id: number,
  fields: {
    text?: string;
    done?: boolean;
    ticker?: string | null;
    remind_at?: string | null;
    trigger_price?: number | null;
    trigger_direction?: TriggerDirection | null;
  }
): PortfolioNote | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.text !== undefined) { sets.push('text = ?'); params.push(fields.text); }
  if (fields.done !== undefined) { sets.push('done = ?'); params.push(fields.done ? 1 : 0); }
  if (fields.ticker !== undefined) { sets.push('ticker = ?'); params.push(fields.ticker); }
  if (fields.remind_at !== undefined) {
    // Rescheduling (or clearing) re-arms the reminder so it can fire again.
    sets.push('remind_at = ?'); params.push(fields.remind_at);
    sets.push('notified_at = NULL');
  }
  if (fields.trigger_price !== undefined) {
    // Changing (or clearing) the price trigger re-arms the alert, same as remind_at.
    sets.push('trigger_price = ?'); params.push(fields.trigger_price);
    sets.push('trigger_direction = ?');
    params.push(fields.trigger_price != null ? fields.trigger_direction ?? 'above' : null);
    sets.push('notified_at = NULL');
  } else if (fields.trigger_direction !== undefined) {
    sets.push('trigger_direction = ?'); params.push(fields.trigger_direction);
    sets.push('notified_at = NULL');
  }
  if (sets.length === 0) {
    const existing = db.prepare('SELECT * FROM portfolio_notes WHERE id = ?').get(id) as NoteRow | undefined;
    return existing ? toNote(existing) : null;
  }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  const result = db
    .prepare(`UPDATE portfolio_notes SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
  if (result.changes === 0) return null;
  const row = db.prepare('SELECT * FROM portfolio_notes WHERE id = ?').get(id) as NoteRow;
  return toNote(row);
}

export function deleteNote(id: number): boolean {
  return db.prepare('DELETE FROM portfolio_notes WHERE id = ?').run(id).changes > 0;
}

/**
 * Open action items whose reminder is due and not yet delivered. remind_at and
 * the comparison value are both ISO 8601 UTC strings, so a lexical `<=` is a
 * valid chronological compare (don't use SQLite datetime('now') here — its
 * space-separated, zoneless format won't sort against the ISO 'T...Z' form).
 */
export function getDueReminders(nowIso: string = new Date().toISOString()): PortfolioNote[] {
  const rows = db
    .prepare(
      `SELECT * FROM portfolio_notes
       WHERE remind_at IS NOT NULL AND notified_at IS NULL AND done = 0 AND remind_at <= ?
       ORDER BY remind_at ASC, id ASC`
    )
    .all(nowIso) as NoteRow[];
  return rows.map(toNote);
}

/**
 * Open action items with an armed price trigger (undelivered, ticker present).
 * The cron runner fetches current prices and decides which have crossed.
 */
export function getOpenPriceTriggers(): PortfolioNote[] {
  const rows = db
    .prepare(
      `SELECT * FROM portfolio_notes
       WHERE trigger_price IS NOT NULL AND ticker IS NOT NULL
         AND notified_at IS NULL AND done = 0
       ORDER BY id ASC`
    )
    .all() as NoteRow[];
  return rows.map(toNote);
}

/** True when a current price satisfies a note's trigger condition. */
export function isTriggerHit(price: number, triggerPrice: number, direction: TriggerDirection): boolean {
  return direction === 'above' ? price >= triggerPrice : price <= triggerPrice;
}

/** Stamp a reminder as delivered so it fires exactly once. */
export function markNotified(id: number, atIso: string = new Date().toISOString()): void {
  db.prepare('UPDATE portfolio_notes SET notified_at = ? WHERE id = ?').run(atIso, id);
}
