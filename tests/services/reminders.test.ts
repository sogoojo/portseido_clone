import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// Exercises the due-reminder selection semantics against a real in-memory DB.
// This mirrors the exact query in getDueReminders(): remind_at and the cutoff are
// both ISO 8601 UTC strings, so a lexical `<=` is a valid chronological compare,
// and a reminder is "due" only when it is set, unsent, and the item is open.

const DUE_QUERY = `
  SELECT id FROM portfolio_notes
  WHERE remind_at IS NOT NULL AND notified_at IS NULL AND done = 0 AND remind_at <= ?
  ORDER BY remind_at ASC, id ASC
`;

const NOW = '2026-06-24T12:00:00.000Z';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE portfolio_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio TEXT NOT NULL,
    ticker TEXT,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    remind_at TEXT,
    notified_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

function insert(db: Database.Database, fields: {
  text: string; remind_at?: string | null; notified_at?: string | null; done?: number;
}): number {
  const r = db
    .prepare('INSERT INTO portfolio_notes (portfolio, text, remind_at, notified_at, done) VALUES (?, ?, ?, ?, ?)')
    .run('global', fields.text, fields.remind_at ?? null, fields.notified_at ?? null, fields.done ?? 0);
  return Number(r.lastInsertRowid);
}

describe('getDueReminders selection', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  const due = () => (db.prepare(DUE_QUERY).all(NOW) as { id: number }[]).map(r => r.id);

  it('includes a past-due, unsent, open reminder', () => {
    const id = insert(db, { text: 'Trim NVDA', remind_at: '2026-06-24T09:00:00.000Z' });
    expect(due()).toEqual([id]);
  });

  it('excludes a reminder whose time is still in the future', () => {
    insert(db, { text: 'Later', remind_at: '2026-06-25T09:00:00.000Z' });
    expect(due()).toEqual([]);
  });

  it('excludes a reminder that was already delivered (notified_at set)', () => {
    insert(db, { text: 'Already sent', remind_at: '2026-06-24T09:00:00.000Z', notified_at: '2026-06-24T10:00:00.000Z' });
    expect(due()).toEqual([]);
  });

  it('excludes a completed action item even if its reminder is due', () => {
    insert(db, { text: 'Done', remind_at: '2026-06-24T09:00:00.000Z', done: 1 });
    expect(due()).toEqual([]);
  });

  it('excludes plain action items with no remind_at', () => {
    insert(db, { text: 'No reminder', remind_at: null });
    expect(due()).toEqual([]);
  });

  it('returns multiple due reminders ordered by time (ISO lexical = chronological)', () => {
    const later = insert(db, { text: 'B', remind_at: '2026-06-24T11:00:00.000Z' });
    const earlier = insert(db, { text: 'A', remind_at: '2026-06-24T08:00:00.000Z' });
    expect(due()).toEqual([earlier, later]);
  });

  it('treats a reminder exactly at the cutoff as due (<=)', () => {
    const id = insert(db, { text: 'On the dot', remind_at: NOW });
    expect(due()).toEqual([id]);
  });
});
