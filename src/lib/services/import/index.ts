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

// --- Shared CSV helpers ---

/**
 * Full CSV parse (RFC-4180 style): handles quoted fields containing commas
 * AND newlines, and escaped quotes (""). Returns one string[] per record.
 * A naive split('\n') + per-line parse breaks records whose product names
 * contain newlines.
 */
export function parseCsv(content: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field.trim());
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      pushRecord();
    } else {
      field += ch;
    }
  }
  pushRecord();
  return records;
}

/**
 * Parse a number that may use thousands separators and either decimal
 * convention: "1,234.56", "1.234,56", "12,50", "1234.56".
 * parseFloat alone reads "1,234.56" as 1 — silent 1000x corruption.
 */
export function parseLocaleNumber(raw: string): number {
  let s = (raw || '').replace(/[\s ]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56 → 1234.56
    } else {
      s = s.replace(/,/g, ''); // 1,234.56 → 1234.56
    }
  } else if (lastComma > -1) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length !== 3) {
      s = s.replace(',', '.'); // 12,50 → 12.50
    } else {
      s = s.replace(/,/g, ''); // 1,234 / 1,234,567 → grouping
    }
  }
  return parseFloat(s);
}

/**
 * Normalise a date string to ISO YYYY-MM-DD (the format every date
 * comparison and sort in the app assumes). Returns null if unparseable.
 */
export function normaliseDate(raw: string): string | null {
  const s = (raw || '').trim().split(/[T ]/)[0]; // drop any time component
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  let m = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/); // YYYY/MM/DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // DD-MM-YYYY or MM-DD-YYYY
  if (m) {
    let [, a, b] = m;
    const year = m[3];
    // Disambiguate: a segment > 12 must be the day; otherwise assume DD/MM (EU)
    if (parseInt(a, 10) <= 12 && parseInt(b, 10) > 12) {
      [a, b] = [b, a]; // it was MM/DD
    }
    return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  return null;
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
  date: ['date', 'trade_date', 'trade date', 'execution date'],
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

const genericParser: ImportParser = {
  parse(csvContent: string): ParsedTransaction[] {
    const records = parseCsv(csvContent);
    if (records.length < 2) return [];

    const headers = records[0];
    const colMap: Record<string, number> = {};
    for (const field of Object.keys(COLUMN_ALIASES)) {
      colMap[field] = findColumn(headers, field);
    }

    const transactions: ParsedTransaction[] = [];

    for (let i = 1; i < records.length; i++) {
      const vals = records[i];
      const get = (field: string): string => {
        const idx = colMap[field];
        return idx >= 0 && idx < vals.length ? vals[idx] : '';
      };
      const getNumber = (field: string): number | undefined => {
        const n = parseLocaleNumber(get(field));
        return Number.isFinite(n) ? n : undefined;
      };

      const date = normaliseDate(get('date'));
      const rawType = get('type').toLowerCase();
      if (!date) continue; // unparseable dates would corrupt every date comparison

      // Normalize type
      let type: ParsedTransaction['type'] = 'buy';
      if (['buy', 'purchase', 'long'].includes(rawType)) type = 'buy';
      else if (['sell', 'sale', 'short'].includes(rawType)) type = 'sell';
      else if (['deposit', 'funding', 'transfer in'].includes(rawType)) type = 'deposit';
      else if (['withdrawal', 'withdraw', 'transfer out'].includes(rawType)) type = 'withdrawal';
      else if (['dividend', 'div', 'distribution'].includes(rawType)) type = 'dividend';
      else continue; // Skip unknown types

      // Quantities/amounts must be stored positive — many brokers export
      // sells as negative quantities, which would break FIFO
      const quantity = getNumber('quantity');
      const amount = getNumber('amount');
      const commission = getNumber('commission');

      const tx: ParsedTransaction = {
        date,
        type,
        ticker: get('ticker') || undefined,
        quantity: quantity != null ? Math.abs(quantity) : undefined,
        price_per_unit: getNumber('price_per_unit'),
        amount: amount != null ? Math.abs(amount) : undefined,
        currency: get('currency') || undefined,
        commission: commission != null ? Math.abs(commission) : 0,
        notes: get('notes') || undefined,
      };

      transactions.push(tx);
    }

    return transactions;
  },
};

// Register the generic parser as the default
registerParser('generic', genericParser);
