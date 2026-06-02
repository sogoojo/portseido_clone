import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Transaction, TransactionType } from '@/lib/types';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'deposit', 'withdrawal', 'dividend'];

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
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));
  const limit = Math.max(1, Math.min(200, parseInt(params.get('limit') || '50', 10)));
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

    if (!account_id || !date || !type || !currency) {
      return NextResponse.json({ error: 'validation', message: 'Missing required fields: account_id, date, type, currency' }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'validation', message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }
    if ((type === 'buy' || type === 'sell') && (!ticker || !quantity || !price_per_unit)) {
      return NextResponse.json({ error: 'validation', message: 'Buy/sell transactions require ticker, quantity, and price_per_unit' }, { status: 400 });
    }
    if ((type === 'deposit' || type === 'withdrawal') && !amount) {
      return NextResponse.json({ error: 'validation', message: 'Deposit/withdrawal transactions require amount' }, { status: 400 });
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
