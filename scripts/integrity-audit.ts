import Database from 'better-sqlite3';
import path from 'path';
import { runIntegrityAudit, type IntegrityAuditReport, type TradePriceEvidence } from '../src/lib/integrity-audit';

function usage(): never {
  console.error('Usage: npm run audit:integrity -- [--db path] [--json]');
  process.exit(1);
}

function parseArgs(argv: string[]): { dbPath: string; json: boolean } {
  let dbPath = path.join(process.cwd(), 'data', 'portseido-lite.db');
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--db' && argv[i + 1]) dbPath = path.resolve(argv[++i]);
    else usage();
  }
  return { dbPath, json };
}

function evidenceSummary(rows: TradePriceEvidence[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.magnitude_match, (counts.get(row.magnitude_match) ?? 0) + 1);
  return [...counts].map(([key, count]) => `${key}=${count}`).join(', ');
}

function printText(report: IntegrityAuditReport): void {
  console.log(`Portseido integrity audit (read-only)\nDatabase: ${report.database_path}\nGenerated: ${report.generated_at}`);
  console.log('\nSummary');
  for (const [key, value] of Object.entries(report.summary)) console.log(`  ${key}: ${value}`);

  console.log('\nInvalid transactions');
  if (report.invalid_transactions.length === 0) console.log('  none');
  for (const row of report.invalid_transactions) console.log(`  #${row.id}: ${row.reasons.join('; ')}`);

  console.log('\nAmount mismatches');
  if (report.amount_mismatches.length === 0) console.log('  none');
  for (const row of report.amount_mismatches) {
    console.log(`  #${row.id} ${row.account_id}/${row.ticker}: recorded=${row.recorded_amount}, computed=${row.computed_amount}, difference=${row.difference}`);
  }

  console.log('\nOversell candidates (evaluated in date/id order per account+ticker)');
  if (report.oversell_candidates.length === 0) console.log('  none');
  for (const row of report.oversell_candidates) {
    console.log(`  #${row.id} ${row.date} ${row.account_id}/${row.ticker}: sold=${row.quantity_sold}, available=${row.quantity_available}, shortfall=${row.shortfall}`);
  }

  console.log('\nExact-economic reconciliation candidates (not confirmed duplicates)');
  if (report.exact_economic_candidates.length === 0) console.log('  none');
  for (const row of report.exact_economic_candidates) {
    const sequence = row.same_day_sequence.map(t => `#${t.id} ${t.type} ${t.quantity}@${t.price_per_unit} ${t.currency}`).join(' | ');
    console.log(`  ${row.date} ${row.account_id}/${row.ticker ?? 'cash'} ${row.type}: candidate_ids=${row.ids.join(',')}`);
    if (sequence) console.log(`    full-day sequence: ${sequence}`);
  }

  console.log('\nMixed-currency positions and cached-close magnitude evidence');
  if (report.mixed_currency_positions.length === 0) console.log('  none');
  for (const row of report.mixed_currency_positions) {
    console.log(`  ${row.account_id}/${row.ticker}: first_buy_currency=${row.first_buy_currency}, currencies=${row.currencies.join(',')}, trades=${row.trade_count}`);
    console.log(`    ${evidenceSummary(row.price_evidence)}`);
    for (const e of row.price_evidence) {
      console.log(`    #${e.id} ${e.date} ${e.type} ${e.recorded_price} ${e.recorded_currency}; close=${e.close_price ?? 'n/a'} ${e.close_currency ?? ''} (${e.close_date ?? 'n/a'}); converted_close=${e.converted_close ?? 'n/a'}; match=${e.magnitude_match}`);
    }
  }

  console.log('\nNotes: price evidence uses only already-cached closes/FX, with no network calls. Candidates require broker-statement review; this command never changes data.');
}

const { dbPath, json } = parseArgs(process.argv.slice(2));
let db: Database.Database | null = null;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const report = runIntegrityAudit(db, dbPath);
  if (json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
} catch (error) {
  console.error(`Integrity audit failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  db?.close();
}
