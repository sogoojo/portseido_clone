import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Transaction, TransactionType } from '@/lib/types';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'deposit', 'withdrawal', 'dividend'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function safeInt(raw: string | null, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

// Shared validation for POST and PUT — both write a full transaction row
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateTransactionBody(body: any): string | null {
  const { account_id, date, type, ticker, quantity, price_per_unit, amount } = body;

  if (!account_id || !date || !type || !body.currency) {
    return 'Missing required fields: account_id, date, type, currency';
  }
  if (!VALID_TYPES.includes(type)) {
    return `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`;
  }
  if (typeof date !== 'string' || !ISO_DATE.test(date)) {
    return 'date must be in YYYY-MM-DD format';
  }
  if ((type === 'buy' || type === 'sell') && (!ticker || !quantity || !price_per_unit)) {
    return 'Buy/sell transactions require ticker, quantity, and price_per_unit';
  }
  if ((type === 'deposit' || type === 'withdrawal') && !amount) {
    return 'Deposit/withdrawal transactions require amount';
  }
  for (const [field, value] of [['quantity', quantity], ['price_per_unit', price_per_unit], ['amount', amount], ['commission', body.commission]] as const) {
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      return `${field} must be a non-negative number`;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
  const params = request.nextUrl.searchParams;
  const account_id = params.get('account_id');
  const ticker = params.get('ticker');
  const type = params.get('type');
  const date_from = params.get('date_from');
  const date_to = params.get('date_to');
  const sort_by = params.get('sort_by') || 'date';
  const sort_dir = params.get('sort_dir') === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, safeInt(params.get('page'), 1));
  const limit = Math.max(1, Math.min(200, safeInt(params.get('limit'), 50)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (account_id && account_id !== 'all') {
    conditions.push('t.account_id = ?');
    values.push(account_id);
  }
  if (ticker) {
    conditions.push('t.ticker LIKE ?');
    values.push(`%${ticker}%`);
  }
  if (type) {
    const types = type.split(',').filter((t) => VALID_TYPES.includes(t as TransactionType));
    if (types.length > 0) {
      conditions.push(`t.type IN (${types.map(() => '?').join(',')})`);
      values.push(...types);
    }
  }
  if (date_from) {
    conditions.push('t.date >= ?');
    values.push(date_from);
  }
  if (date_to) {
    conditions.push('t.date <= ?');
    values.push(date_to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const allowedSorts = ['date', 'type', 'ticker', 'amount', 'quantity', 'price_per_unit', 'commission', 'account_id'];
  const sortCol = allowedSorts.includes(sort_by) ? `t.${sort_by}` : 't.date';

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM transactions t ${where}`)
    .get(...values) as { total: number };

  const transactions = db
    .prepare(
      `SELECT t.*, a.name as account_name FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id ${where} ORDER BY ${sortCol} ${sort_dir}, t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as (Transaction & { account_name: string })[];

  return NextResponse.json({
    data: transactions,
    total: countRow.total,
    page,
    limit,
  });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission, notes } = body;

    const validationError = validateTransactionBody(body);
    if (validationError) {
      return NextResponse.json({ error: 'validation', message: validationError }, { status: 400 });
    }

    const computedAmount = amount ?? (quantity && price_per_unit ? quantity * price_per_unit : null);

    const result = db
      .prepare(
        `INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(account_id, date, type, ticker || null, quantity || null, price_per_unit || null, computedAmount, currency, commission || 0, notes || null);

    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid) as Transaction;
    return NextResponse.json({ data: transaction }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'validation', message: 'Missing transaction id' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'not_found', message: 'Transaction not found' }, { status: 404 });
    }

    // PUT is full-replace: validate exactly like POST so an update cannot
    // write a row that downstream FIFO/cash calculations silently ignore
    const validationError = validateTransactionBody(body);
    if (validationError) {
      return NextResponse.json({ error: 'validation', message: validationError }, { status: 400 });
    }

    const computedAmount = amount ?? (quantity && price_per_unit ? quantity * price_per_unit : null);

    db.prepare(
      `UPDATE transactions SET account_id = ?, date = ?, type = ?, ticker = ?, quantity = ?, price_per_unit = ?, amount = ?, currency = ?, commission = ?, notes = ? WHERE id = ?`
    ).run(account_id, date, type, ticker || null, quantity || null, price_per_unit || null, computedAmount, currency, commission || 0, notes || null, id);

    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Transaction;
    return NextResponse.json({ data: transaction });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'validation', message: 'Missing transaction id' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'not_found', message: 'Transaction not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
