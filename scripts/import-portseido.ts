/**
 * Import all_transactions.csv from Portseido export into the database.
 * Replaces all existing transaction data.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'portseido-lite.db');
const CSV_PATH = path.join(process.cwd(), 'doc', 'all_transactions.csv');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Account mapping: Portfolio name → account_id
const ACCOUNT_MAP: Record<string, string> = {
  'Degiro': 'degiro',
  'Trading212': 'trading212',
  'Trader Republic': 'trader-republic',
  'Crypto': 'crypto',
  'Morgan Stanley': 'morgan-stanley',
};

// Account currencies
const ACCOUNT_CURRENCY: Record<string, string> = {
  'degiro': 'EUR',
  'trading212': 'USD',
  'trader-republic': 'EUR',
  'crypto': 'USD',
  'morgan-stanley': 'USD',
};

// Ticker remapping
const TICKER_MAP: Record<string, string> = {
  'VWRA.L': 'VWCE.DE',       // Same fund, EUR listing on XETRA
  'GOOGLCL.SN': 'GOOGL',     // Google on Santiago → US listing
  'TRIRF': 'TRIT',           // OTC → primary listing
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Read CSV
const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = csvContent.split('\n').filter(l => l.trim());
const headers = parseCsvLine(lines[0]);

interface Row {
  Portfolio: string;
  Date: string;
  Ticker: string;
  Action: string;
  Shares: string;
  Price: string;
  Commission: string;
  Currency: string;
}

const rows: Row[] = [];
for (let i = 1; i < lines.length; i++) {
  const vals = parseCsvLine(lines[i]);
  const row: Record<string, string> = {};
  headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
  rows.push(row as unknown as Row);
}

console.log(`Parsed ${rows.length} rows from CSV`);

// Clear existing data
db.prepare('DELETE FROM transactions').run();
db.prepare('DELETE FROM price_cache').run();
db.prepare('DELETE FROM fx_cache').run();
console.log('Cleared existing transactions and caches');

const insert = db.prepare(
  `INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let imported = 0;
let skipped = 0;

const importAll = db.transaction(() => {
  for (const row of rows) {
    const accountId = ACCOUNT_MAP[row.Portfolio];
    if (!accountId) {
      console.warn(`Unknown portfolio: ${row.Portfolio}`);
      skipped++;
      continue;
    }

    const acctCurrency = ACCOUNT_CURRENCY[accountId];
    const action = row.Action;
    const isCash = row.Ticker === 'CASH';

    // Skip fees and taxes
    if (action === 'Fees' || action === 'Taxes') {
      skipped++;
      continue;
    }

    if (isCash) {
      // Cash deposit/withdrawal
      if (action === 'Deposit' || action === 'Withdraw') {
        const type = action === 'Deposit' ? 'deposit' : 'withdrawal';
        const amount = parseFloat(row.Shares) || 0;
        const currency = row.Currency || acctCurrency;

        // Only import deposits/withdrawals in account currency
        // (FX conversion deposits are internal cash movements)
        // We'll import all and let getCashBalance handle it
        insert.run(
          accountId,
          row.Date,
          type,
          null,       // no ticker
          null,       // no quantity
          null,       // no price
          amount,
          currency,
          0,
          null
        );
        imported++;
      } else {
        skipped++;
      }
      continue;
    }

    // Buy/Sell trade
    if (action !== 'Buy' && action !== 'Sell') {
      console.warn(`Unknown action: ${action} for ${row.Ticker}`);
      skipped++;
      continue;
    }

    let ticker = row.Ticker;
    if (TICKER_MAP[ticker]) {
      ticker = TICKER_MAP[ticker];
    }

    const type = action.toLowerCase() as 'buy' | 'sell';
    const quantity = parseFloat(row.Shares) || 0;
    const price = parseFloat(row.Price) || 0;
    const commission = parseFloat(row.Commission) || 0;
    const currency = row.Currency || acctCurrency;
    const amount = quantity * price;

    insert.run(
      accountId,
      row.Date,
      type,
      ticker,
      quantity,
      price,
      amount,
      currency,
      commission,
      null
    );
    imported++;
  }
});

importAll();

// Summary
console.log(`\nImported: ${imported}`);
console.log(`Skipped: ${skipped} (fees, taxes, unknown)`);

// Verify
const counts = db.prepare(
  `SELECT account_id, type, COUNT(*) as cnt FROM transactions GROUP BY account_id, type ORDER BY account_id, type`
).all() as { account_id: string; type: string; cnt: number }[];

console.log('\nTransaction counts:');
for (const { account_id, type, cnt } of counts) {
  console.log(`  ${account_id.padEnd(20)} ${type.padEnd(12)} ${cnt}`);
}

// Show open positions per account
const tickers = db.prepare(
  `SELECT DISTINCT account_id, ticker FROM transactions WHERE type IN ('buy', 'sell') AND ticker IS NOT NULL ORDER BY account_id, ticker`
).all() as { account_id: string; ticker: string }[];

console.log('\nTickers per account:');
let currentAcct = '';
for (const { account_id, ticker } of tickers) {
  if (account_id !== currentAcct) {
    currentAcct = account_id;
    process.stdout.write(`\n  ${account_id}: `);
  }
  process.stdout.write(`${ticker} `);
}
console.log('');

db.close();
