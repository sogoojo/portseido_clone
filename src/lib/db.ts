import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { seedAccounts } from './seed';

const DB_PATH = path.join(process.cwd(), 'data', 'portseido-lite.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema migration
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// Migrations
const migrations = [
  `ALTER TABLE price_cache ADD COLUMN previous_close REAL`,
  `ALTER TABLE price_cache ADD COLUMN change REAL`,
  `ALTER TABLE price_cache ADD COLUMN change_pct REAL`,
  `ALTER TABLE accounts ADD COLUMN track_cash INTEGER NOT NULL DEFAULT 1`,
  `UPDATE accounts SET track_cash = 0 WHERE id IN ('trading212', 'degiro', 'morgan-stanley', 'crypto', 'ngx')`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// Seed accounts on first connection
seedAccounts(db);

export default db;
