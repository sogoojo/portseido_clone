import { parseCsv, parseLocaleNumber, type ParsedTransaction } from './index';

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

// Convert DD-MM-YYYY to YYYY-MM-DD
function parseDate(raw: string): string {
  const parts = raw.split('-');
  if (parts.length !== 3) return raw;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const degiroParser = {
  parse(csvContent: string): ParsedTransaction[] {
    // Record-level parse: product names can contain commas AND newlines
    const records = parseCsv(csvContent);
    if (records.length < 2) return [];

    // Verify header
    const header = records[0].join(',');
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
      FX_RATE: 12,
      AUTO_FX_FEE: 13,
      TX_FEE: 14,
      TOTAL_EUR: 15,
      ORDER_ID: 16,
    };

    const transactions: ParsedTransaction[] = [];

    for (let i = 1; i < records.length; i++) {
      const vals = records[i];
      const dateRaw = vals[COL.DATE];

      // Skip rows without a valid date pattern
      if (!dateRaw || !/^\d{2}-\d{2}-\d{4}$/.test(dateRaw)) continue;

      const quantity = parseLocaleNumber(vals[COL.QUANTITY]);
      if (!quantity || !isFinite(quantity)) continue;

      const price = parseLocaleNumber(vals[COL.PRICE]);
      if (!isFinite(price)) continue;

      // Skip zero-price rows (corporate actions like warrant/share distributions)
      if (price === 0) continue;

      const isin = vals[COL.ISIN] || '';
      const product = vals[COL.PRODUCT] || '';
      const currency = vals[COL.PRICE_CURRENCY] || 'EUR';

      // Resolve ticker
      const ticker = ISIN_TO_TICKER[isin] || isin || product;

      // Buy/sell from quantity sign
      const type: 'buy' | 'sell' = quantity > 0 ? 'buy' : 'sell';
      const absQuantity = Math.abs(quantity);

      // Commission = |AutoFX Fee| + |Transaction fees| — these columns are
      // EUR in Degiro exports. The row's currency is the PRICE currency, so
      // for non-EUR trades convert the fee using the row's own exchange rate
      // (quoted as price-currency per EUR).
      const autoFx = Math.abs(parseLocaleNumber(vals[COL.AUTO_FX_FEE]) || 0);
      const txFee = Math.abs(parseLocaleNumber(vals[COL.TX_FEE]) || 0);
      let commission = autoFx + txFee;
      if (currency !== 'EUR' && commission > 0) {
        const fxRate = parseLocaleNumber(vals[COL.FX_RATE]);
        if (isFinite(fxRate) && fxRate > 0) {
          commission = commission * fxRate;
        }
      }

      const amount = absQuantity * price;
      const orderId = vals[COL.ORDER_ID] || '';

      transactions.push({
        date: parseDate(dateRaw),
        type,
        ticker,
        quantity: absQuantity,
        price_per_unit: price,
        amount,
        currency,
        commission,
        // Order ID makes re-imports detectable
        notes: orderId ? `${product} [${orderId}]` : product,
      });
    }

    return transactions;
  },
};

export default degiroParser;
