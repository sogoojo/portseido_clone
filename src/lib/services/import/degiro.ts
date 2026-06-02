import type { ParsedTransaction } from './index';

// ISIN → Yahoo Finance ticker mapping
const ISIN_TO_TICKER: Record<string, string> = {
  'US0231351067': 'AMZN',
  'US30303M1027': 'META',
  'US02079K3059': 'GOOGL',
  'US92826C8394': 'V',
  'US81141R1005': 'SE',
  'KYG6683N1034': 'NU',
  'NL0012969182': 'ADYEN.AS',
  'US90138F1021': 'TWLO',
  'US11135F1012': 'AVGO',
  'US5949181045': 'MSFT',
  'US67066G1040': 'NVDA',
  'US58733R1023': 'MELI',
  'US87918A1051': 'TDOC',
  'US88160R1014': 'TSLA',
  'IE00B3XXRP09': 'VUSA.AS',
  'IE00BK5BQT80': 'VWCE.DE',
  'US0378331005': 'AAPL',
  'US8522341036': 'SQ',
  'US70450Y1038': 'PYPL',
  'US29786A1060': 'ETSY',
  'US18915M1071': 'NET',
  'US0090661010': 'ABNB',
  'US79466L3024': 'CRM',
  'US98741T1043': 'DAO',
  'KYG9103H1020': 'TRIT',
  'US69608A1088': 'PLTR',
  'US31188V1008': 'FSLY',
  'US0846707026': 'BRK-B',
  'US6745991058': 'OXY',
  'US6745991629': 'OXY-WT', // warrants
  'US92918V1098': 'VRM',
  'US5391831030': 'LVGO', // delisted (Livongo)
  'NL0000235190': 'AIR.PA',
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

// Convert DD-MM-YYYY to YYYY-MM-DD
function parseDate(raw: string): string {
  const parts = raw.split('-');
  if (parts.length !== 3) return raw;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const degiroParser = {
  parse(csvContent: string): ParsedTransaction[] {
    const lines = csvContent.split('\n');
    if (lines.length < 2) return [];

    // Verify header
    const header = lines[0];
    if (!header.includes('Product') || !header.includes('ISIN')) {
      return []; // Not a Degiro CSV
    }

    // Column indices (based on Degiro export format):
    // 0=Date, 1=Time, 2=Product, 3=ISIN, 4=Ref exchange, 5=Venue,
    // 6=Quantity, 7=Price, 8=(price currency), 9=Local value, 10=(local currency),
    // 11=Value EUR, 12=Exchange rate, 13=AutoFX Fee, 14=Transaction fees EUR,
    // 15=Total EUR, 16=Order ID
    const COL = {
      DATE: 0,
      PRODUCT: 2,
      ISIN: 3,
      QUANTITY: 6,
      PRICE: 7,
      PRICE_CURRENCY: 8,
      AUTO_FX_FEE: 13,
      TX_FEE: 14,
      TOTAL_EUR: 15,
    };

    const transactions: ParsedTransaction[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const vals = parseCsvLine(line);
      const dateRaw = vals[COL.DATE];

      // Skip continuation lines (multi-line product names)
      if (!dateRaw || dateRaw === '') continue;

      // Skip if no valid date pattern
      if (!/^\d{2}-\d{2}-\d{4}$/.test(dateRaw)) continue;

      const quantity = parseFloat(vals[COL.QUANTITY]);
      if (!quantity || !isFinite(quantity)) continue;

      const price = parseFloat(vals[COL.PRICE]);
      if (!isFinite(price)) continue;

      // Skip zero-price rows (corporate actions like warrant distributions)
      if (price === 0 && Math.abs(quantity) <= 1) continue;

      const isin = vals[COL.ISIN] || '';
      const product = vals[COL.PRODUCT] || '';
      const currency = vals[COL.PRICE_CURRENCY] || 'EUR';

      // Resolve ticker
      const ticker = ISIN_TO_TICKER[isin] || isin || product;

      // Buy/sell from quantity sign
      const type: 'buy' | 'sell' = quantity > 0 ? 'buy' : 'sell';
      const absQuantity = Math.abs(quantity);

      // Commission = |AutoFX Fee| + |Transaction fees|
      const autoFx = Math.abs(parseFloat(vals[COL.AUTO_FX_FEE]) || 0);
      const txFee = Math.abs(parseFloat(vals[COL.TX_FEE]) || 0);
      const commission = autoFx + txFee;

      const amount = absQuantity * price;

      transactions.push({
        date: parseDate(dateRaw),
        type,
        ticker,
        quantity: absQuantity,
        price_per_unit: price,
        amount,
        currency,
        commission,
        notes: product,
      });
    }

    return transactions;
  },
};

export default degiroParser;
