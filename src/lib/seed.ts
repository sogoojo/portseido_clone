import type Database from 'better-sqlite3';

const SEED_ACCOUNTS = [
  { id: 'degiro', name: 'Degiro', broker: 'degiro', currency: 'EUR', track_cash: 0 },
  { id: 'trading212', name: 'Trading212', broker: 'trading212', currency: 'USD', track_cash: 0 },
  { id: 'crypto', name: 'Crypto', broker: 'crypto', currency: 'USD', track_cash: 0 },
  { id: 'morgan-stanley', name: 'Morgan Stanley', broker: 'morgan-stanley', currency: 'USD', track_cash: 0 },
  { id: 'trader-republic', name: 'Trader Republic', broker: 'trader-republic', currency: 'EUR', track_cash: 1 },
  { id: 'ngx', name: 'NGX Portfolio', broker: 'ngx', currency: 'NGN', track_cash: 0 },
];

export function seedAccounts(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
  if (count.count > 0) return;

  // OR IGNORE: parallel processes (e.g. next build workers) can both pass the
  // count guard on a fresh DB — the second insert must not crash module init
  const insert = db.prepare('INSERT OR IGNORE INTO accounts (id, name, broker, currency, track_cash) VALUES (?, ?, ?, ?, ?)');
  const run = db.transaction(() => {
    for (const a of SEED_ACCOUNTS) {
      insert.run(a.id, a.name, a.broker, a.currency, a.track_cash);
    }
  });
  run();
}
