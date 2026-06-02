import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getParser } from '@/lib/services/import';
import degiroParser from '@/lib/services/import/degiro';

interface ImportTransaction {
  date: string;
  type: string;
  ticker?: string;
  quantity?: number | null;
  price_per_unit?: number | null;
  amount?: number | null;
  currency?: string;
  commission?: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { account_id, transactions, broker, csv_content } = body as {
      account_id: string;
      transactions?: ImportTransaction[];
      broker?: string;
      csv_content?: string;
    };

    // If broker + raw CSV provided, use server-side parser
    if (broker && csv_content) {
      const parser = broker === 'degiro' ? degiroParser : getParser(broker);
      const parsed = parser.parse(csv_content);
      transactions = parsed;
    }

    if (!account_id) {
      return NextResponse.json({ error: 'validation', message: 'account_id is required' }, { status: 400 });
    }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account_id);
    if (!account) {
      return NextResponse.json({ error: 'not_found', message: 'Account not found' }, { status: 404 });
    }

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json({ error: 'validation', message: 'No transactions provided' }, { status: 400 });
    }

    const insert = db.prepare(
      `INSERT INTO transactions (account_id, date, type, ticker, quantity, price_per_unit, amount, currency, commission, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let imported = 0;
    const importAll = db.transaction(() => {
      for (const t of transactions) {
        if (!t.date || !t.type) continue;

        const type = t.type.toLowerCase();
        const validTypes = ['buy', 'sell', 'deposit', 'withdrawal', 'dividend'];
        if (!validTypes.includes(type)) continue;

        const computedAmount = t.amount ?? (t.quantity && t.price_per_unit ? t.quantity * t.price_per_unit : null);

        insert.run(
          account_id,
          t.date,
          type,
          t.ticker || null,
          t.quantity || null,
          t.price_per_unit || null,
          computedAmount,
          t.currency || (account as { currency: string }).currency,
          t.commission || 0,
          t.notes || null
        );
        imported++;
      }
    });

    importAll();

    return NextResponse.json({ data: { imported } });
  } catch (err) {
    return NextResponse.json({ error: 'server', message: (err as Error).message }, { status: 500 });
  }
}
