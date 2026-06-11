import { describe, it, expect } from 'vitest';
import { parseCsv, parseLocaleNumber, normaliseDate, getParser } from '@/lib/services/import';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,qty\n"Apple, Inc.",5')).toEqual([['name', 'qty'], ['Apple, Inc.', '5']]);
  });

  it('keeps newlines inside quoted fields', () => {
    const records = parseCsv('name,qty\n"Line1\nLine2",5');
    expect(records).toEqual([['name', 'qty'], ['Line1\nLine2', '5']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('skips empty lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseLocaleNumber', () => {
  it('parses plain numbers', () => {
    expect(parseLocaleNumber('1234.56')).toBe(1234.56);
  });

  it('parses US grouping (1,234.56)', () => {
    expect(parseLocaleNumber('1,234.56')).toBe(1234.56);
  });

  it('parses EU grouping (1.234,56)', () => {
    expect(parseLocaleNumber('1.234,56')).toBe(1234.56);
  });

  it('parses comma decimal (12,50)', () => {
    expect(parseLocaleNumber('12,50')).toBe(12.5);
  });

  it('parses grouping-only comma (1,234)', () => {
    expect(parseLocaleNumber('1,234')).toBe(1234);
  });

  it('parses negative values', () => {
    expect(parseLocaleNumber('-1,234.56')).toBe(-1234.56);
  });

  it('returns NaN for empty input', () => {
    expect(Number.isNaN(parseLocaleNumber(''))).toBe(true);
  });
});

describe('normaliseDate', () => {
  it('passes ISO through', () => {
    expect(normaliseDate('2024-03-15')).toBe('2024-03-15');
  });

  it('converts DD/MM/YYYY', () => {
    expect(normaliseDate('15/03/2024')).toBe('2024-03-15');
  });

  it('converts MM/DD/YYYY when the day disambiguates', () => {
    expect(normaliseDate('03/15/2024')).toBe('2024-03-15');
  });

  it('assumes DD/MM for ambiguous dates', () => {
    expect(normaliseDate('05/03/2024')).toBe('2024-03-05');
  });

  it('handles YYYY/MM/DD', () => {
    expect(normaliseDate('2024/3/5')).toBe('2024-03-05');
  });

  it('drops time components', () => {
    expect(normaliseDate('2024-03-15 10:30:00')).toBe('2024-03-15');
  });

  it('returns null for garbage', () => {
    expect(normaliseDate('not a date')).toBeNull();
  });
});

describe('generic parser', () => {
  const parser = getParser('generic');

  it('normalises negative sell quantities to positive', () => {
    const csv = 'date,type,symbol,quantity,price\n2024-01-15,sell,AAPL,-10,190.50';
    const txs = parser.parse(csv);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('sell');
    expect(txs[0].quantity).toBe(10);
    expect(txs[0].price_per_unit).toBe(190.5);
  });

  it('normalises non-ISO dates', () => {
    const csv = 'date,type,symbol,quantity,price\n15/01/2024,buy,AAPL,10,190.50';
    const txs = parser.parse(csv);
    expect(txs[0].date).toBe('2024-01-15');
  });

  it('skips rows with unparseable dates instead of storing garbage', () => {
    const csv = 'date,type,symbol,quantity,price\nsoon,buy,AAPL,10,190.50';
    expect(parser.parse(csv)).toHaveLength(0);
  });

  it('parses thousands separators in amounts', () => {
    const csv = 'date,type,symbol,quantity,price,amount\n2024-01-15,buy,AAPL,10,"1,234.56","12,345.60"';
    const txs = parser.parse(csv);
    expect(txs[0].price_per_unit).toBe(1234.56);
    expect(txs[0].amount).toBe(12345.6);
  });

  it('skips unknown transaction types', () => {
    const csv = 'date,type,symbol,quantity,price\n2024-01-15,transfer,AAPL,10,190.50';
    expect(parser.parse(csv)).toHaveLength(0);
  });
});
