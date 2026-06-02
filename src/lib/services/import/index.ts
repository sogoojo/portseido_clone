export interface ParsedTransaction {
  date: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend';
  ticker?: string;
  quantity?: number;
  price_per_unit?: number;
  amount?: number;
  currency?: string;
  commission?: number;
  notes?: string;
}

export interface ImportParser {
  parse(csvContent: string): ParsedTransaction[];
}

// Parser registry — broker-specific parsers will be added here
const parsers = new Map<string, ImportParser>();

export function registerParser(broker: string, parser: ImportParser) {
  parsers.set(broker, parser);
}

export function getParser(broker: string): ImportParser {
  return parsers.get(broker) || genericParser;
}

// Column name aliases for the generic parser
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date', 'trade_date', 'trade date', 'execution date', 'time'],
  type: ['type', 'action', 'side', 'transaction type'],
  ticker: ['ticker', 'symbol', 'isin', 'instrument', 'name', 'stock'],
  quantity: ['quantity', 'shares', 'qty', 'no. of shares', 'units'],
  price_per_unit: ['price', 'price_per_unit', 'price per unit', 'unit price', 'execution price'],
  amount: ['amount', 'total', 'value', 'net amount', 'total amount', 'result'],
  currency: ['currency', 'ccy', 'currency (price)'],
  commission: ['commission', 'fee', 'fees', 'transaction fee', 'charges'],
  notes: ['notes', 'description', 'comment', 'reference'],
};

function findColumn(headers: string[], field: string): number {
  const aliases = COLUMN_ALIASES[field] || [field];
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.toLowerCase().trim() === alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

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

const genericParser: ImportParser = {
  parse(csvContent: string): ParsedTransaction[] {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]);
    const colMap: Record<string, number> = {};
    for (const field of Object.keys(COLUMN_ALIASES)) {
      colMap[field] = findColumn(headers, field);
    }

    const transactions: ParsedTransaction[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCsvLine(lines[i]);
      const get = (field: string): string => {
        const idx = colMap[field];
        return idx >= 0 && idx < vals.length ? vals[idx] : '';
      };

      const date = get('date');
      const rawType = get('type').toLowerCase();
      if (!date) continue;

      // Normalize type
      let type: ParsedTransaction['type'] = 'buy';
      if (['buy', 'purchase', 'long'].includes(rawType)) type = 'buy';
      else if (['sell', 'sale', 'short'].includes(rawType)) type = 'sell';
      else if (['deposit', 'funding', 'transfer in'].includes(rawType)) type = 'deposit';
      else if (['withdrawal', 'withdraw', 'transfer out'].includes(rawType)) type = 'withdrawal';
      else if (['dividend', 'div', 'distribution'].includes(rawType)) type = 'dividend';
      else continue; // Skip unknown types

      const tx: ParsedTransaction = {
        date,
        type,
        ticker: get('ticker') || undefined,
        quantity: parseFloat(get('quantity')) || undefined,
        price_per_unit: parseFloat(get('price_per_unit')) || undefined,
        amount: parseFloat(get('amount')) || undefined,
        currency: get('currency') || undefined,
        commission: parseFloat(get('commission')) || 0,
        notes: get('notes') || undefined,
      };

      transactions.push(tx);
    }

    return transactions;
  },
};

// Register the generic parser as the default
registerParser('generic', genericParser);
