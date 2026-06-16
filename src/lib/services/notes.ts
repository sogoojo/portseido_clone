import db from '@/lib/db';
import type { NotePortfolio, PortfolioNote } from '@/lib/types';

// SQLite stores `done` as INTEGER 0/1 — normalise to boolean at the boundary.
interface NoteRow {
  id: number;
  portfolio: string;
  ticker: string | null;
  text: string;
  done: number;
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

export function addNote(portfolio: NotePortfolio, text: string, ticker?: string | null): PortfolioNote {
  const result = db
    .prepare('INSERT INTO portfolio_notes (portfolio, ticker, text) VALUES (?, ?, ?)')
    .run(portfolio, ticker ?? null, text);
  const row = db
    .prepare('SELECT * FROM portfolio_notes WHERE id = ?')
    .get(result.lastInsertRowid) as NoteRow;
  return toNote(row);
}

export function updateNote(
  id: number,
  fields: { text?: string; done?: boolean; ticker?: string | null }
): PortfolioNote | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.text !== undefined) { sets.push('text = ?'); params.push(fields.text); }
  if (fields.done !== undefined) { sets.push('done = ?'); params.push(fields.done ? 1 : 0); }
  if (fields.ticker !== undefined) { sets.push('ticker = ?'); params.push(fields.ticker); }
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
